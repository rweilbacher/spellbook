package com.spellbook

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import java.io.File
import java.util.Calendar

/**
 * Up to three reminders a day, at times you choose.
 *
 * The times and the wording live in `settings` inside `spellbook.json`, next to
 * every other preference — so they ride along on the export, land in the backup
 * folder, and survive a restore without a second store to keep in step. That
 * also means this object can read them at boot without the WebView, exactly as
 * `Book` reads spells for the widget.
 *
 * Nothing is drawn here. The notification is a knock on the door; the spell is
 * still cast by hand when you open the book. That keeps `drawn` and `lastDrawn`
 * honest — a reminder you never looked at shouldn't spend a spell.
 */
object Reminders {

    /**
     * More than three isn't a reminder. This is the only definition of the
     * cap: the page reads it off notifyState() instead of keeping a second
     * copy — see notifyLimits() in js/reminders.js and docs/bridge.md.
     */
    const val MAX = 3

    /** Likewise the wording. One definition, sent across the bridge. */
    const val DEFAULT_TEXT = "The book is open. Where are you?"

    internal const val ACTION_FIRE = "com.spellbook.REMIND"

    private const val CHANNEL = "reminders"
    private const val REQUEST_BASE = 700

    /**
     * One id for all three slots on purpose: an unread reminder is replaced by
     * the next one rather than stacking. Three identical lines in the shade is
     * nagging, and nagging is the failure mode this feature has.
     */
    private const val NOTIFICATION_ID = 7001

    private const val PREFS = "reminders"
    private const val KEY_SIG = "signature"

    class Plan(val minutes: List<Int>, val text: String)

    // ------------------------------------------------------------- the settings

    fun read(context: Context): Plan {
        val file = File(context.filesDir, "spellbook.json")
        if (!file.isFile) return Plan(emptyList(), DEFAULT_TEXT)
        return runCatching { parse(file.readText()) }
            .getOrDefault(Plan(emptyList(), DEFAULT_TEXT))
    }

    /** Kept separate from [read] so a save can hand over the JSON it already has. */
    fun parse(json: String): Plan {
        val settings = JSONObject(json).optJSONObject("settings")
            ?: return Plan(emptyList(), DEFAULT_TEXT)

        val raw = settings.optJSONArray("notifyTimes")
        val minutes = ArrayList<Int>()
        if (raw != null) {
            for (i in 0 until raw.length()) {
                val m = toMinutes(raw.optString(i)) ?: continue
                if (!minutes.contains(m)) minutes.add(m)
            }
        }
        // Sorted before the cap, not after — the page writes them sorted, so
        // this only bites on a hand-edited file, and there the three you'd
        // expect to survive are the three earliest, not the first three typed.
        minutes.sort()
        val capped = if (minutes.size > MAX) minutes.subList(0, MAX).toList() else minutes

        val text = settings.optString("notifyText").trim().ifEmpty { DEFAULT_TEXT }
        return Plan(capped, text)
    }

    /** "HH:mm" as minutes past local midnight, or null if it isn't one. */
    private fun toMinutes(value: String?): Int? {
        val parts = (value ?: "").split(":")
        if (parts.size < 2) return null
        val h = parts[0].trim().toIntOrNull() ?: return null
        val m = parts[1].trim().toIntOrNull() ?: return null
        if (h !in 0..23 || m !in 0..59) return null
        return h * 60 + m
    }

    // ------------------------------------------------------------- the alarms

    /**
     * Re-arm everything from what's on disk. Idempotent — each slot's alarm is
     * replaced rather than added to, and a slot with no time set stays
     * cancelled. Safe to call as often as it's convenient, which is why the
     * activity does it on every launch.
     */
    fun arm(context: Context) {
        runCatching {
            val manager = context.getSystemService(AlarmManager::class.java) ?: return
            val plan = read(context)
            // Made as soon as there's anything to announce, not at the first
            // notification — so the channel is there to be tuned in Android's
            // settings before it has ever gone off.
            if (plan.minutes.isNotEmpty()) channel(context)
            for (slot in 0 until MAX) {
                val pending = fireIntent(context, slot)
                if (slot < plan.minutes.size) {
                    // Inexact and allowed while idle, like the widget's midnight
                    // turn: a nudge that lands at 09:04 instead of 09:00 is still
                    // the nudge, and this asks for none of the permissions an
                    // exact alarm puts behind a prompt.
                    manager.setAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP, nextOccurrence(plan.minutes[slot]), pending
                    )
                } else {
                    manager.cancel(pending)
                }
            }
        }
    }

    /**
     * Called after every save. The book is written on every edit and the times
     * change about twice a year, so compare first and do nothing the other
     * ten thousand times.
     */
    fun syncFrom(context: Context, json: String) {
        val plan = runCatching { parse(json) }.getOrNull() ?: return
        val sig = plan.minutes.joinToString(",") + "|" + plan.text
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getString(KEY_SIG, null) == sig) return
        prefs.edit().putString(KEY_SIG, sig).apply()
        arm(context)
    }

    /**
     * The next time today's clock reads this. The minute of grace is what stops
     * an alarm that fires a hair early from re-arming itself for the same
     * instant and going round again.
     */
    private fun nextOccurrence(minutes: Int): Long {
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, minutes / 60)
            set(Calendar.MINUTE, minutes % 60)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        if (cal.timeInMillis <= System.currentTimeMillis() + 60_000L) {
            cal.add(Calendar.DAY_OF_YEAR, 1)
        }
        return cal.timeInMillis
    }

    /**
     * PendingIntents are matched on everything but their extras, so the slot has
     * to be in the request code and the data — otherwise all three collapse into
     * one alarm and only the last one set survives.
     */
    private fun fireIntent(context: Context, slot: Int): PendingIntent =
        PendingIntent.getBroadcast(
            context, REQUEST_BASE + slot,
            Intent(context, ReminderReceiver::class.java)
                .setAction(ACTION_FIRE)
                .setData(Uri.parse("spellbook://reminder/$slot")),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    // ------------------------------------------------------- the notification

    /** Granted, and not switched off for the app in system settings. */
    fun canPost(context: Context): Boolean {
        val granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) return false
        return runCatching {
            NotificationManagerCompat.from(context).areNotificationsEnabled()
        }.getOrDefault(true)
    }

    /** canPost() above is the check lint can't see through. */
    @SuppressLint("MissingPermission")
    fun post(context: Context) {
        if (!canPost(context)) return
        runCatching {
            channel(context)
            val plan = read(context)
            if (plan.minutes.isEmpty()) return   // switched off between arm and fire

            val open = Intent(context, MainActivity::class.java)
                .setAction(Intent.ACTION_VIEW)
                .putExtra(MainActivity.EXTRA_OPEN, MainActivity.OPEN_DRAW)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)

            val tap = PendingIntent.getActivity(
                context, REQUEST_BASE, open,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            // The whole message is the title. There is no second line to write,
            // and a title alone renders at the size the one line deserves.
            val note = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setColor(context.getColor(R.color.brass))
                .setContentTitle(plan.text)
                .setContentIntent(tap)
                .setAutoCancel(true)
                .setOnlyAlertOnce(false)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .build()

            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, note)
        }
    }

    private fun channel(context: Context) {
        runCatching {
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL,
                    context.getString(R.string.channel_reminders),
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = context.getString(R.string.channel_reminders_desc)
                    setShowBadge(false)
                }
            )
        }
    }
}

/**
 * Everything that has to re-arm the alarms. They don't survive a reboot or an
 * app update, and a clock or timezone change moves the times they were set for
 * — the same four events the widget's midnight turn listens for.
 */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Reminders.ACTION_FIRE -> {
                Reminders.post(context)
                Reminders.arm(context)   // sets this slot for tomorrow
            }
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED,
            Intent.ACTION_MY_PACKAGE_REPLACED -> Reminders.arm(context)
        }
    }
}
