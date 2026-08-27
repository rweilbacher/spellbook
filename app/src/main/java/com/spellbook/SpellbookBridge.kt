package com.spellbook

import android.content.ContentValues
import android.content.Context
import android.provider.MediaStore
import android.webkit.JavascriptInterface
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The whole persistence layer: one JSON file in the app's private directory.
 *
 * Deliberately not IndexedDB. A file can be read by a home-screen widget later,
 * copied out as a backup, and carried into a native rewrite without migration.
 * At ~150 spells the file is around 100KB, so rewriting it on every edit is free.
 */
class SpellbookBridge(private val ctx: Context) {

    private val book get() = File(ctx.filesDir, "spellbook.json")
    private val backupDir get() = File(ctx.filesDir, "backups").apply { mkdirs() }
    private val weeklyMarker get() = File(ctx.filesDir, "last-weekly-export")

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
            autoWeeklyExport(json)
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
     * uninstall or "clear data" deletes along with the book. This one lands
     * in the public Downloads folder instead, so it survives anything short
     * of wiping the phone. Runs silently off the back of every save, at most
     * once a week.
     */
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
}
