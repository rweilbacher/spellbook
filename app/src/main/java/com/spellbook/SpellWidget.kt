package com.spellbook

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.widget.RemoteViews
import org.json.JSONObject
import java.io.File
import java.util.Calendar
import java.util.Random
import java.util.TimeZone

/**
 * One spell on the home screen, changing at midnight.
 *
 * The widget reads `files/spellbook.json` itself and never writes to it — no
 * `drawn` count, no `lastDrawn`, nothing that could race the WebView's save.
 * Which spell you get is derived, not stored: the day number seeds the pick, so
 * every refresh within a day lands on the same spell and no state has to be
 * kept anywhere. The last seven days are recomputed the same way and excluded,
 * which is a no-repeat window that costs nothing to remember.
 *
 * The app's own draw weights apply (inbox over-represented, flagged dialled
 * down); its sticky filters deliberately do not — those are where you are while
 * browsing, not a standing instruction about the home screen.
 */
class SpellWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val spell = Book.spellOfTheDay(context)
        for (id in ids) render(context, manager, id, spell)
        scheduleMidnight(context)
    }

    /** Resized: the text autosizes itself, but the pick is worth re-reading. */
    override fun onAppWidgetOptionsChanged(
        context: Context,
        manager: AppWidgetManager,
        id: Int,
        newOptions: Bundle
    ) {
        render(context, manager, id, Book.spellOfTheDay(context))
    }

    override fun onEnabled(context: Context) {
        scheduleMidnight(context)
    }

    override fun onDisabled(context: Context) {
        runCatching {
            context.getSystemService(AlarmManager::class.java)?.cancel(midnightIntent(context))
        }
    }

    /**
     * Alarms don't survive a reboot or an app update, and a clock or timezone
     * change moves midnight. Each of those re-arms and re-renders.
     */
    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        when (intent.action) {
            ACTION_DAILY,
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED,
            Intent.ACTION_MY_PACKAGE_REPLACED -> refresh(context)
        }
    }

    companion object {

        private const val ACTION_DAILY = "com.spellbook.WIDGET_DAY"

        /**
         * Called from the bridge after every save, so burying or editing the
         * spell on the home screen shows up there rather than a day later.
         * Cheap when no widget is placed, which is the common case.
         */
        fun refresh(context: Context) {
            runCatching {
                val manager = AppWidgetManager.getInstance(context) ?: return
                val ids = manager.getAppWidgetIds(ComponentName(context, SpellWidget::class.java))
                if (ids.isEmpty()) return
                val spell = Book.spellOfTheDay(context)
                for (id in ids) render(context, manager, id, spell)
                scheduleMidnight(context)
            }
        }

        private fun render(
            context: Context,
            manager: AppWidgetManager,
            id: Int,
            spell: Book.Spell?
        ) {
            val views = RemoteViews(context.packageName, R.layout.widget_spell)

            // A tap lands on this spell's own detail sheet, not just the app —
            // the page reads this the same way it reads a reminder's "draw".
            val open = Intent(context, MainActivity::class.java)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            if (spell != null) {
                open.putExtra(MainActivity.EXTRA_OPEN, MainActivity.OPEN_SPELL_PREFIX + spell.id)
            }
            views.setOnClickPendingIntent(
                android.R.id.background,
                PendingIntent.getActivity(
                    context, 0, open,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            )

            if (spell == null) {
                views.setTextViewText(R.id.widget_spell, context.getString(R.string.widget_empty))
                views.setTextColor(R.id.widget_spell, context.getColor(R.color.dim))
                views.setViewVisibility(R.id.widget_tags, android.view.View.GONE)
            } else {
                views.setTextViewText(R.id.widget_spell, styled(context, spell.text))
                views.setTextColor(R.id.widget_spell, context.getColor(R.color.ink))
                val tags = spell.tags.joinToString("  ·  ").uppercase()
                views.setTextViewText(R.id.widget_tags, tags)
                views.setViewVisibility(
                    R.id.widget_tags,
                    if (tags.isEmpty()) android.view.View.GONE else android.view.View.VISIBLE
                )
            }

            manager.updateAppWidget(id, views)
        }

        /** The editor's `**bold**`, `*italic*` and `==highlight==`, as spans. */
        private val MARKUP =
            Regex("""\*\*(.+?)\*\*|\*(.+?)\*|==(.+?)==""", RegexOption.DOT_MATCHES_ALL)

        private fun styled(context: Context, text: String): CharSequence {
            val out = SpannableStringBuilder()
            var at = 0
            for (m in MARKUP.findAll(text)) {
                out.append(text, at, m.range.first)
                val bold = m.groupValues[1]
                val italic = m.groupValues[2]
                val mark = m.groupValues[3]
                val start = out.length
                when {
                    bold.isNotEmpty() -> {
                        out.append(bold)
                        out.setSpan(
                            StyleSpan(Typeface.BOLD), start, out.length,
                            Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
                        )
                    }
                    italic.isNotEmpty() -> {
                        out.append(italic)
                        out.setSpan(
                            StyleSpan(Typeface.ITALIC), start, out.length,
                            Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
                        )
                    }
                    else -> {
                        out.append(mark)
                        out.setSpan(
                            ForegroundColorSpan(context.getColor(R.color.brass)), start, out.length,
                            Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
                        )
                    }
                }
                at = m.range.last + 1
            }
            out.append(text, at, text.length)
            return out
        }

        // ------------------------------------------------------------ midnight

        /**
         * Inexact and allowed while idle: one wake a day, a few minutes of drift
         * at worst, and no need for the exact-alarm permission Android 12 put
         * behind a user prompt. A widget turning over at 00:03 is still a widget
         * turning over at midnight.
         */
        private fun scheduleMidnight(context: Context) {
            runCatching {
                val manager = context.getSystemService(AlarmManager::class.java) ?: return
                val next = Calendar.getInstance().apply {
                    add(Calendar.DAY_OF_YEAR, 1)
                    set(Calendar.HOUR_OF_DAY, 0)
                    set(Calendar.MINUTE, 0)
                    set(Calendar.SECOND, 5)
                    set(Calendar.MILLISECOND, 0)
                }.timeInMillis
                manager.setAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP, next, midnightIntent(context)
                )
            }
        }

        private fun midnightIntent(context: Context): PendingIntent =
            PendingIntent.getBroadcast(
                context, 0,
                Intent(context, SpellWidget::class.java).setAction(ACTION_DAILY),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
    }
}

/**
 * The book, read from the outside. Kotlin talking to the same JSON file the web
 * app writes — the reason the store was never IndexedDB.
 */
internal object Book {

    class Spell(val id: String, val text: String, val tags: List<String>, val weight: Double)

    /** Days a spell has to sit out before it can come round again. */
    private const val WINDOW = 7

    /**
     * How far back the walk actually starts. It has to be longer than the
     * window: reconstructing yesterday's pick from a walk that began seven days
     * ago gives it a shorter history than yesterday itself had, and a
     * reconstruction that disagrees with what you actually saw lets a spell
     * repeat inside the week. Three weeks of warm-up settles it — over a decade
     * of days against the current book, no repeat inside seven.
     */
    private const val LOOKBACK = 21

    private const val INBOX = "inbox"
    private const val FLAGGED = "flagged"

    fun spellOfTheDay(context: Context): Spell? {
        return try {
            val file = File(context.filesDir, "spellbook.json")
            if (!file.isFile) return null
            val doc = JSONObject(file.readText())
            val settings = doc.optJSONObject("settings")
            val inboxWeight = weight(settings, "inboxWeight", 3.0)
            val flaggedWeight = weight(settings, "flaggedWeight", 1.0)

            val spells = doc.optJSONArray("spells") ?: return null
            val pool = ArrayList<Spell>(spells.length())
            for (i in 0 until spells.length()) {
                val o = spells.optJSONObject(i) ?: continue
                // Written as "is it active", not "is it buried" — which is
                // why the shelf needed no change here: a third state was
                // excluded the day it started existing. Keep the test this way
                // round. The book has three piles now (active / shelved /
                // graveyard) and may grow a fourth. See docs/decisions/0009.
                if (o.optString("state") != "active") continue
                val text = o.optString("text").trim()
                if (text.isEmpty()) continue

                val tags = ArrayList<String>()
                val raw = o.optJSONArray("tags")
                if (raw != null) {
                    for (j in 0 until raw.length()) {
                        val t = raw.optString(j)
                        if (t.isNotEmpty()) tags.add(t)
                    }
                }

                var w = 1.0
                if (tags.contains(INBOX)) w *= inboxWeight
                if (tags.contains(FLAGGED)) w *= flaggedWeight
                pool.add(Spell(o.optString("id", "sp_$i"), text, tags, if (w > 0.0) w else 0.0))
            }
            if (pool.isEmpty()) return null

            // Walk the recent days forward, each day's pick excluding the ones
            // before it. Deterministic, so this is the same answer every time.
            val today = dayNumber()
            val recent = ArrayList<String>(WINDOW + 1)
            var chosen: Spell? = null
            var day = today - LOOKBACK
            while (day <= today) {
                val fresh = pool.filter { !recent.contains(it.id) }
                val bag = if (fresh.isEmpty()) pool else fresh
                val pick = weighted(bag, Random(seedFor(day)))
                recent.add(pick.id)
                if (recent.size > WINDOW) recent.removeAt(0)
                chosen = pick
                day++
            }
            chosen
        } catch (e: Exception) {
            null
        }
    }

    private fun weight(settings: JSONObject?, key: String, fallback: Double): Double {
        val v = settings?.optDouble(key, fallback) ?: fallback
        return if (v.isNaN() || v < 0.0) fallback else v
    }

    private fun weighted(bag: List<Spell>, rnd: Random): Spell {
        var total = 0.0
        for (s in bag) total += s.weight
        if (total <= 0.0) return bag[rnd.nextInt(bag.size)]
        var r = rnd.nextDouble() * total
        for (s in bag) {
            r -= s.weight
            if (r < 0.0) return s
        }
        return bag[bag.size - 1]
    }

    /** Local days since the epoch — the unit the day turns over in. */
    private fun dayNumber(): Long {
        val now = System.currentTimeMillis()
        return Math.floorDiv(now + TimeZone.getDefault().getOffset(now), 86_400_000L)
    }

    /**
     * splitmix64. Consecutive seeds handed straight to java.util.Random draw
     * suspiciously similar first numbers; scrambling the day first is what makes
     * one day's spell unrelated to the next.
     */
    private fun seedFor(day: Long): Long {
        var z = day * -7046029254386353131L + -4658895280553007687L
        z = (z xor (z ushr 30)) * -4658895280553007687L
        z = (z xor (z ushr 27)) * -7723592293110705685L
        return z xor (z ushr 31)
    }
}
