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

    /** Export lands in the public Downloads folder, reachable by any file app. */
    @JavascriptInterface
    fun export(name: String, data: String): String = runCatching {
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, "application/json")
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val resolver = ctx.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: return "the app folder"
        resolver.openOutputStream(uri)?.use { it.write(data.toByteArray()) }
        values.clear()
        values.put(MediaStore.Downloads.IS_PENDING, 0)
        resolver.update(uri, values, null, null)
        "Downloads"
    }.getOrElse {
        File(ctx.getExternalFilesDir(null), name).writeText(data)
        "the app folder"
    }
}
