package com.spellbook

import android.content.ContentValues
import android.content.Context
import android.provider.MediaStore
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The whole persistence layer: one JSON file in the app's private directory,
 * plus a media folder beside it for voice notes.
 *
 * Deliberately not IndexedDB. A file can be read by a home-screen widget later,
 * copied out as a backup, and carried into a native rewrite without migration.
 * At ~150 spells the file is around 100KB, so rewriting it on every edit is
 * free — which is exactly why audio never goes in it.
 *
 * Every method here runs on a binder thread, not the main thread. Anything that
 * needs the main thread (launching a permission prompt or the folder picker)
 * hops there explicitly; the recorder posts for itself.
 */
class SpellbookBridge(private val act: MainActivity) {

    private val ctx: Context get() = act

    private val book get() = File(ctx.filesDir, "spellbook.json")
    private val backupDir get() = File(ctx.filesDir, "backups").apply { mkdirs() }
    private val weeklyMarker get() = File(ctx.filesDir, "last-weekly-export")
    private val mediaDir get() = File(ctx.filesDir, "media").apply { mkdirs() }

    /** Empty string means "nothing saved yet" — the web app then seeds itself. */
    @JavascriptInterface
    fun load(): String = runCatching {
        if (book.exists()) book.readText() else ""
    }.getOrDefault("")

    /** Write to a temp file first so a crash mid-write can't leave a half book. */
    @JavascriptInterface
    fun save(json: String) {
        runCatching {
            val tmp = File(ctx.filesDir, "spellbook.json.tmp")
            tmp.writeText(json)
            if (book.exists()) book.delete()
            if (!tmp.renameTo(book)) book.writeText(json)
            rollBackup(json)
            offsite(json)
        }
    }

    /** One snapshot per day, seven kept. Silent insurance against a bad import. */
    private fun rollBackup(json: String) {
        val stamp = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val snap = File(backupDir, "spellbook-$stamp.json")
        if (snap.exists()) return
        snap.writeText(json)
        backupDir.listFiles()
            ?.sortedByDescending { it.name }
            ?.drop(7)
            ?.forEach { it.delete() }
    }

    /**
     * The daily backup above lives in the app's private directory, which an
     * uninstall or "clear data" deletes along with the book. This one leaves it.
     *
     * If a backup folder has been picked, that's where it goes — book and
     * recordings both, at most once a day. If not, the old weekly JSON drop
     * into Downloads still happens, so the app is never less safe than it was.
     */
    private fun offsite(json: String) {
        // A recording in progress is a file still being written; let it finish
        // and be carried by the next backup rather than copying half of it.
        if (act.voice.isRecording) return
        if (act.backups.folder() != null) {
            if (act.backups.due()) act.backups.writeNow(json, mediaDir)
        } else {
            autoWeeklyExport(json)
        }
    }

    private fun autoWeeklyExport(json: String) {
        val last = runCatching { weeklyMarker.readText().trim().toLong() }.getOrDefault(0L)
        val weekMs = 7L * 24 * 60 * 60 * 1000
        if (System.currentTimeMillis() - last < weekMs) return
        val stamp = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        if (writeToDownloads("spellbook-weekly-$stamp.json", json)) {
            runCatching { weeklyMarker.writeText(System.currentTimeMillis().toString()) }
        }
    }

    /** Export lands in the public Downloads folder, reachable by any file app. */
    @JavascriptInterface
    fun export(name: String, data: String): String {
        if (writeToDownloads(name, data)) return "Downloads"
        return runCatching {
            File(ctx.getExternalFilesDir(null), name).writeText(data)
            "the app folder"
        }.getOrDefault("the app folder")
    }

    /** Shared MediaStore write, used by both the manual export and the automatic weekly one. */
    private fun writeToDownloads(name: String, data: String): Boolean = runCatching {
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, "application/json")
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val resolver = ctx.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: return false
        resolver.openOutputStream(uri)?.use { it.write(data.toByteArray()) }
        values.clear()
        values.put(MediaStore.Downloads.IS_PENDING, 0)
        resolver.update(uri, values, null, null)
        true
    }.getOrDefault(false)

    // ------------------------------------------------------------ voice notes

    /**
     * Fire and forget. Everything that happens next — permission, routing to a
     * headset, levels, the finished file — comes back through window.onNative,
     * because none of it is knowable by the time this returns.
     */
    @JavascriptInterface
    fun startVoiceNote(preferBluetooth: Boolean) {
        act.runOnUiThread { act.startVoiceNote(preferBluetooth) }
    }

    @JavascriptInterface
    fun stopVoiceNote() { act.voice.stop() }

    @JavascriptInterface
    fun cancelVoiceNote() { act.voice.cancel() }

    /** Is there a headset to record through right now — for the Vault's copy. */
    @JavascriptInterface
    fun bluetoothMicAvailable(): Boolean =
        runCatching { act.voice.bluetoothAvailable() }.getOrDefault(false)

    /** What's actually on disk, so a note whose audio is gone can say so
     *  instead of rendering a player that will never play. */
    @JavascriptInterface
    fun mediaList(): String {
        val names = mediaDir.listFiles().orEmpty()
            .filter { it.isFile && VoiceRecorder.safeName(it.name) }
            .map { it.name }
        return JSONArray(names).toString()
    }

    @JavascriptInterface
    fun deleteMedia(name: String): Boolean {
        if (!VoiceRecorder.safeName(name)) return false
        return runCatching { File(mediaDir, name).delete() }.getOrDefault(false)
    }

    /**
     * Housekeeping at boot: anything on disk that no note refers to any more.
     * Skipped while recording, since the file being written isn't on a note yet.
     */
    @JavascriptInterface
    fun pruneMedia(referenced: String): Int {
        if (act.voice.isRecording) return 0
        val keep = runCatching {
            val arr = JSONArray(referenced)
            (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotEmpty() }.toSet()
        }.getOrNull() ?: return 0
        var gone = 0
        for (f in mediaDir.listFiles().orEmpty()) {
            if (!f.isFile || !VoiceRecorder.safeName(f.name)) continue
            if (keep.contains(f.name)) continue
            if (f.delete()) gone++
        }
        return gone
    }

    // ---------------------------------------------------------- backup folder

    @JavascriptInterface
    fun backupInfo(): String = runCatching { act.backups.info().toString() }
        .getOrDefault("{\"set\":false,\"label\":\"\"}")

    @JavascriptInterface
    fun pickBackupFolder() {
        act.runOnUiThread { act.pickBackupFolder() }
    }

    @JavascriptInterface
    fun clearBackupFolder() {
        runCatching { act.backups.forget() }
    }

    /** The manual "Back up now". Synchronous on purpose — the page waits and
     *  reports what happened, rather than guessing. */
    @JavascriptInterface
    fun backupNow(json: String): String = runCatching {
        act.backups.writeNow(json, mediaDir).toString()
    }.getOrDefault(JSONObject().put("ok", false).put("message", "The backup didn't finish").toString())
}
