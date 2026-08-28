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
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * The whole persistence layer: one JSON file in the app's private directory,
 * plus a media folder beside it for voice notes.
 *
 * Deliberately not IndexedDB. A file can be read by the home-screen widget,
 * copied out as a backup, and carried into a native rewrite without migration.
 * At ~150 spells the file is around 100KB, so rewriting it on every edit is
 * free — which is exactly why audio never goes in it.
 *
 * Every method here runs on a binder thread, not the main thread. Anything that
 * needs the main thread (launching a permission prompt or the folder picker)
 * hops there explicitly; the recorder posts for itself.
 */
class SpellbookBridge(private val act: MainActivity) {

    companion object {
        private val DAILY = Regex("""^spellbook-\d{4}-\d{2}-\d{2}\.json$""")
        private val PRE_RESTORE = Regex("""^pre-restore-\d{8}-\d{6}\.json$""")

        /**
         * The offsite copy runs here rather than on the caller's thread. One
         * thread, so two saves can never write the same folder at once, and
         * the page is never blocked on a SAF write to what may be a cloud
         * mount. persist() fires on every card action; a hang here is felt as
         * a random tap that sticks.
         */
        private val offsiteThread: ExecutorService =
            Executors.newSingleThreadExecutor { r ->
                Thread(r, "spellbook-offsite").apply { isDaemon = true }
            }

        /** The manual "Back up now" comes in on a binder thread while the
         *  automatic one may be running here. One folder, one writer. */
        private val offsiteLock = Any()
    }

    private val ctx: Context get() = act

    private val book get() = File(ctx.filesDir, "spellbook.json")
    private val backupDir get() = File(ctx.filesDir, "backups").apply { mkdirs() }
    private val weeklyMarker get() = File(ctx.filesDir, "last-weekly-export")
    private val mediaDir get() = File(ctx.filesDir, "media").apply { mkdirs() }

    /** Empty string means "nothing saved yet" — but ask bookState() first. */
    @JavascriptInterface
    fun load(): String = runCatching {
        if (book.exists()) book.readText() else ""
    }.getOrDefault("")

    /**
     * "missing" | "ok" | "unreadable" — so the page can tell a first run from
     * a book it must not overwrite.
     *
     * load() alone can't: an I/O failure on a book that exists returns "",
     * the same answer as "there is no book", and the page then seeds over it.
     * Three states used to collapse into one, and seeding is right for only
     * one of them.
     */
    @JavascriptInterface
    fun bookState(): String = when {
        !book.exists() -> "missing"
        runCatching { book.readText() }.isSuccess -> "ok"
        else -> "unreadable"
    }

    /** Write to a temp file first so a crash mid-write can't leave a half book. */
    @JavascriptInterface
    fun save(json: String) {
        runCatching {
            val tmp = File(ctx.filesDir, "spellbook.json.tmp")
            tmp.writeText(json)
            if (book.exists()) book.delete()
            if (!tmp.renameTo(book)) book.writeText(json)
            rollBackup(json)
            // Off the caller's thread: the JavaScript call is blocked until
            // this method returns, and offsite() can reach a cloud-backed
            // provider. The book is already on disk by this line, which is
            // the part the page is actually waiting for.
            offsiteThread.execute { runCatching { synchronized(offsiteLock) { offsite(json) } } }
            // The widget reads this file for itself, so a spell buried or
            // edited here shows up on the home screen now rather than at the
            // next midnight. Cheap when no widget is placed.
            SpellWidget.refresh(ctx)
            // Reminder times live in this file too, so a save is also where a
            // changed time reaches the alarm manager. Compares before it acts —
            // the times change about twice a year, the book on every edit.
            Reminders.syncFrom(ctx, json)
        }
    }

    /** One snapshot per day, seven kept. Silent insurance against a bad import. */
    private fun rollBackup(json: String) {
        val stamp = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val snap = File(backupDir, "spellbook-$stamp.json")
        if (snap.exists()) return
        snap.writeText(json)
        // Prune the dailies only. The pre-restore copies beside them are kept
        // by their own rule, and sort under a different prefix.
        backupDir.listFiles()
            ?.filter { DAILY.matches(it.name) }
            ?.sortedByDescending { it.name }
            ?.drop(7)
            ?.forEach { it.delete() }
    }

    /**
     * The snapshots above, newest first, as the page's "Earlier versions"
     * list. Seven days of dailies plus any pre-restore copies. They have
     * existed since the first save; until now nothing could reach them
     * without adb.
     *
     * [{"name":"spellbook-2026-08-27.json","at":1787…,"bytes":102400,"spells":148}]
     */
    @JavascriptInterface
    fun snapshots(): String = runCatching {
        val arr = JSONArray()
        backupDir.listFiles().orEmpty()
            .filter { it.isFile && safeSnapshot(it.name) }
            .sortedByDescending { it.lastModified() }
            .forEach { f ->
                // Counting spells means parsing the file. Seven files of about
                // 100KB, once, when the list is opened — worth it, because a
                // date alone doesn't tell you which copy you want.
                val spells = runCatching {
                    JSONObject(f.readText()).optJSONArray("spells")?.length() ?: -1
                }.getOrDefault(-1)
                arr.put(
                    JSONObject()
                        .put("name", f.name)
                        .put("at", f.lastModified())
                        .put("bytes", f.length())
                        .put("spells", spells)
                )
            }
        arr.toString()
    }.getOrDefault("[]")

    /** Read one back. Returns the JSON text, or "" if the name isn't one of ours. */
    @JavascriptInterface
    fun readSnapshot(name: String): String {
        if (!safeSnapshot(name)) return ""
        return runCatching {
            val f = File(backupDir, name)
            if (f.isFile) f.readText() else ""
        }.getOrDefault("")
    }

    /**
     * The book as it stands, kept beside the snapshots before something
     * replaces it, so a restore started by mistake is itself reversible.
     * Returns the name written, or "" if it couldn't be.
     */
    @JavascriptInterface
    fun preRestoreBackup(json: String): String = runCatching {
        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
        val f = File(backupDir, "pre-restore-$stamp.json")
        f.writeText(json)
        // Three is plenty: these exist to undo the restore you just did.
        backupDir.listFiles()
            ?.filter { PRE_RESTORE.matches(it.name) }
            ?.sortedByDescending { it.name }
            ?.drop(3)
            ?.forEach { it.delete() }
        f.name
    }.getOrDefault("")

    /**
     * A name the page handed back is only ever one we wrote. Validated
     * before the filesystem is touched at all — the same discipline as
     * VoiceRecorder.safeName, and for the same reason.
     */
    private fun safeSnapshot(name: String) = DAILY.matches(name) || PRE_RESTORE.matches(name)

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

    // -------------------------------------------------------------- reminders

    /**
     * The times themselves are the page's — they're settings in the book it
     * already holds. All Kotlin knows that the page doesn't is whether Android
     * will actually let a notification through, which is what this answers.
     */
    @JavascriptInterface
    fun notifyState(): String = runCatching {
        JSONObject()
            .put("canPost", Reminders.canPost(ctx))
            .put("max", Reminders.MAX)
            .put("defaultText", Reminders.DEFAULT_TEXT)
            .toString()
    }.getOrDefault("{\"canPost\":false,\"max\":3}")

    @JavascriptInterface
    fun requestNotifyPermission() {
        act.runOnUiThread { act.requestNotifyPermission() }
    }

    @JavascriptInterface
    fun openNotificationSettings() {
        act.runOnUiThread { act.openNotificationSettings() }
    }

    /** Where a reminder tap wants the page to land, read once at boot. */
    @JavascriptInterface
    fun openRequest(): String = runCatching { act.takeOpenRequest() }.getOrDefault("")

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
        synchronized(offsiteLock) { act.backups.writeNow(json, mediaDir) }.toString()
    }.getOrDefault(JSONObject().put("ok", false).put("message", "The backup didn't finish").toString())
}
