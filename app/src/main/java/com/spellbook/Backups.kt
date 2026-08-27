package com.spellbook

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * A folder you pick once, that the book and its recordings are copied into.
 *
 * The weekly JSON drop into Downloads was insurance built when the book was the
 * only thing worth insuring. Audio changes that, and Downloads is the wrong
 * place to accumulate a media folder. Point this at something a sync app
 * already mirrors and the offsite copy costs no code here at all.
 *
 * Nothing here runs on the main thread — it's called from the bridge, off the
 * back of a save, or from "Back up now".
 */
class Backups(private val ctx: Context) {

    private val prefs get() = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // ------------------------------------------------------------ the folder

    /** The chosen folder, but only while the system still honours our grant —
     *  a folder that was deleted or a permission revoked reads as unset, which
     *  is what we want the UI to say. */
    fun folder(): Uri? {
        val raw = prefs.getString(KEY_URI, null) ?: return null
        val uri = runCatching { Uri.parse(raw) }.getOrNull() ?: return null
        val held = ctx.contentResolver.persistedUriPermissions.any {
            it.uri == uri && it.isWritePermission
        }
        return if (held) uri else null
    }

    fun remember(uri: Uri) {
        val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        runCatching { ctx.contentResolver.takePersistableUriPermission(uri, flags) }
        prefs.getString(KEY_URI, null)?.let { old ->
            if (old != uri.toString()) runCatching {
                ctx.contentResolver.releasePersistableUriPermission(Uri.parse(old), flags)
            }
        }
        prefs.edit().putString(KEY_URI, uri.toString()).remove(KEY_LAST).apply()
    }

    fun forget() {
        val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        prefs.getString(KEY_URI, null)?.let { old ->
            runCatching { ctx.contentResolver.releasePersistableUriPermission(Uri.parse(old), flags) }
        }
        prefs.edit().remove(KEY_URI).remove(KEY_LAST).apply()
    }

    /** Something readable for the Vault: "Documents/Spellbook" rather than a
     *  content:// URI nobody can parse at a glance. */
    fun label(): String {
        val uri = folder() ?: return ""
        val seg = uri.lastPathSegment.orEmpty()
        val tail = seg.substringAfter(':', seg)
        if (tail.isNotBlank()) return tail
        return runCatching { DocumentFile.fromTreeUri(ctx, uri)?.name }.getOrNull().orEmpty()
    }

    fun info(): JSONObject {
        val uri = folder()
        return JSONObject()
            .put("set", uri != null)
            .put("label", if (uri != null) label() else "")
            .put("lastAt", prefs.getLong(KEY_LAST, 0L))
    }

    /** Riding along on an ordinary save, the same way the weekly export does —
     *  but daily, because there's audio to carry now. */
    fun due(): Boolean {
        if (folder() == null) return false
        return System.currentTimeMillis() - prefs.getLong(KEY_LAST, 0L) >= DAY_MS
    }

    // -------------------------------------------------------------- the copy

    fun writeNow(json: String, mediaDir: File): JSONObject {
        val uri = folder()
            ?: return result(false, "No backup folder is set")
        val root = runCatching { DocumentFile.fromTreeUri(ctx, uri) }.getOrNull()
        if (root == null || !root.canWrite()) {
            return result(false, "Can't write to that folder any more")
        }

        return runCatching {
            val stamp = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
            val existing = root.listFiles()

            // One snapshot per day, replaced if the day already has one.
            val bookName = "spellbook-$stamp.json"
            existing.firstOrNull { it.name == bookName }?.delete()
            val book = root.createFile("application/json", bookName)
                ?: return result(false, "Couldn't create the backup file")
            ctx.contentResolver.openOutputStream(book.uri)?.use {
                it.write(json.toByteArray(Charsets.UTF_8))
            } ?: return result(false, "Couldn't write the backup file")

            val copied = copyMedia(root, mediaDir)
            prune(root.listFiles())

            prefs.edit().putLong(KEY_LAST, System.currentTimeMillis()).apply()
            result(true, if (copied > 0) "Backed up · $copied new recording${if (copied == 1) "" else "s"}" else "Backed up")
        }.getOrElse { result(false, "The backup didn't finish") }
    }

    /**
     * One copy of each recording, ever — a backup that re-copied the lot daily
     * would be worse than useless.
     *
     * Identity is the stem (`vn_ab12cd` out of `vn_ab12cd.m4a`), not the whole
     * filename, because we don't own the name that ends up there: createFile
     * hands the display name to the folder's provider, which is entitled to
     * normalise the extension to match the MIME type. If it does, matching on
     * the full name misses every single time — so every backup copies every
     * recording again, and the provider dutifully uniquifies each one with a
     * "(1)" suffix. Stems survive that.
     *
     * Recordings never change once written, so a stem that's already there with
     * the right size is done. Anything else sharing that stem is a leftover
     * from an interrupted copy, not a second backup, and goes.
     */
    private fun copyMedia(root: DocumentFile, mediaDir: File): Int {
        val local = mediaDir.listFiles().orEmpty()
            .filter { it.isFile && VoiceRecorder.safeName(it.name) }
        if (local.isEmpty()) return 0

        val dir = root.listFiles().firstOrNull { it.name == MEDIA && it.isDirectory }
            ?: root.createDirectory(MEDIA)
            ?: return 0

        val there = dir.listFiles().filter { it.isFile }.groupBy { stem(it.name.orEmpty()) }
        var copied = 0

        for (f in local) {
            val already = there[stem(f.name)].orEmpty()
            val good = already.firstOrNull { it.length() == f.length() }
            if (good != null) {
                already.filter { it.uri != good.uri }.forEach { runCatching { it.delete() } }
                continue
            }
            already.forEach { runCatching { it.delete() } }

            val out = dir.createFile("audio/mp4", f.name) ?: continue
            val ok = runCatching {
                ctx.contentResolver.openOutputStream(out.uri)?.use { o ->
                    f.inputStream().use { it.copyTo(o) }
                } != null
            }.getOrDefault(false)
            if (ok) copied++ else runCatching { out.delete() }
        }
        return copied
    }

    private fun stem(name: String): String = name.substringBefore('.')

    /** Dated snapshots accumulate forever otherwise. Audio is never pruned —
     *  a recording whose note still exists must stay. */
    private fun prune(files: Array<DocumentFile>) {
        val snaps = files.filter { it.isFile && SNAPSHOT.matches(it.name.orEmpty()) }
        if (snaps.size <= KEEP) return
        snaps.sortedByDescending { it.name.orEmpty() }.drop(KEEP).forEach { runCatching { it.delete() } }
    }

    private fun result(ok: Boolean, message: String) =
        JSONObject().put("ok", ok).put("message", message)

    companion object {
        private const val PREFS = "spellbook"
        private const val KEY_URI = "backupTree"
        private const val KEY_LAST = "backupLastAt"
        private const val MEDIA = "media"
        private const val KEEP = 14
        private const val DAY_MS = 24L * 60 * 60 * 1000
        private val SNAPSHOT = Regex("^spellbook-\\d{4}-\\d{2}-\\d{2}.*\\.json$")
    }
}
