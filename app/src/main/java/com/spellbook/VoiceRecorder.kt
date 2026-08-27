package com.spellbook

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.File
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Voice notes, recorded here rather than in the web layer.
 *
 * The web layer could have done this — getUserMedia works fine on the internal
 * https origin the assets are served from — but it hands you whatever input the
 * system considers default and gives you no say in it. Routing to a headset is
 * the whole reason this feature exists, so the recorder lives on this side and
 * the page is told only { file, duration } when it's finished.
 *
 * Everything runs on the main looper. Bridge methods arrive on a binder thread,
 * so they post here rather than touching the recorder directly.
 */
class VoiceRecorder(
    private val ctx: Context,
    private val emit: (JSONObject) -> Unit
) {

    val mediaDir: File get() = File(ctx.filesDir, "media").apply { mkdirs() }

    private val main = Handler(Looper.getMainLooper())
    private val audio = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    // Read from the bridge thread (a save asking whether it's safe to copy the
    // media folder), written from the main one.
    @Volatile private var rec: MediaRecorder? = null
    private var target: File? = null
    private var startedAt = 0L
    private var viaBluetooth = false

    /** Bumped on every start and every abort, so a routing wait that outlives
     *  its own session can tell and bail instead of starting a stale recording. */
    private var session = 0
    @Volatile private var arming = false

    val isRecording: Boolean get() = rec != null || arming

    fun hasPermission(): Boolean = ContextCompat.checkSelfPermission(
        ctx, Manifest.permission.RECORD_AUDIO
    ) == PackageManager.PERMISSION_GRANTED

    /** A headset microphone, if one is connected. Deliberately does not read
     *  the device's name — that would drag in BLUETOOTH_CONNECT for a string
     *  the UI doesn't need. */
    private fun bluetoothMic(): AudioDeviceInfo? =
        runCatching {
            audio.availableCommunicationDevices.firstOrNull {
                it.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
                    it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
            }
        }.getOrNull()

    fun bluetoothAvailable(): Boolean = bluetoothMic() != null

    // ---------------------------------------------------------------- start

    fun start(preferBluetooth: Boolean) = main.post {
        if (isRecording) return@post
        if (!hasPermission()) { emit(ev("denied")); return@post }

        val my = ++session
        arming = true
        viaBluetooth = false

        val bt = if (preferBluetooth) bluetoothMic() else null
        if (bt == null) { begin(my, null); return@post }

        val took = runCatching { audio.setCommunicationDevice(bt) }.getOrDefault(false)
        if (!took) { begin(my, null); return@post }

        // The link takes a moment to come up. Capturing before it does loses
        // the first second or two, which on a note this short is most of it.
        emit(ev("routing"))
        awaitRoute(my, bt, SystemClock.elapsedRealtime() + ROUTE_TIMEOUT_MS)
    }

    private fun awaitRoute(my: Int, dev: AudioDeviceInfo, deadline: Long) {
        if (my != session) { arming = false; clearRoute(); return }
        if (audio.communicationDevice?.id == dev.id) { viaBluetooth = true; begin(my, dev); return }
        if (SystemClock.elapsedRealtime() >= deadline) {
            // Headset connected but the link won't come up. Better a note
            // recorded on the built-in mic than no note.
            clearRoute()
            emit(ev("fellBack"))
            begin(my, null)
            return
        }
        main.postDelayed({ awaitRoute(my, dev, deadline) }, 80)
    }

    private fun begin(my: Int, dev: AudioDeviceInfo?) {
        if (my != session) { arming = false; clearRoute(); return }
        arming = false

        val file = File(mediaDir, newName())
        val r = MediaRecorder(ctx)
        val ok = runCatching {
            r.setAudioSource(
                if (dev != null) MediaRecorder.AudioSource.VOICE_COMMUNICATION
                else MediaRecorder.AudioSource.MIC
            )
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioChannels(1)
            // A headset link is narrowband anyway; asking for more than it can
            // give just wastes bytes.
            r.setAudioSamplingRate(if (dev != null) 16_000 else 44_100)
            r.setAudioEncodingBitRate(if (dev != null) 32_000 else 64_000)
            r.setOutputFile(file)
            r.setOnErrorListener { _, _, _ -> main.post { fail("The recorder stopped unexpectedly") } }
            r.prepare()
            if (dev != null) r.setPreferredDevice(dev)
            r.start()
        }.isSuccess

        if (!ok) {
            runCatching { r.release() }
            file.delete()
            clearRoute()
            emit(ev("error").put("message", "Couldn't start recording"))
            return
        }

        rec = r
        target = file
        startedAt = SystemClock.elapsedRealtime()
        emit(ev("started").put("bluetooth", viaBluetooth))
        main.post(ticker)
    }

    // ----------------------------------------------------------------- stop

    /** Stop and keep. Also what onPause calls, so leaving the app finishes a
     *  note rather than losing it. */
    fun stop() = main.post {
        if (arming && rec == null) { abort("cancelled"); return@post }
        val r = rec ?: return@post
        val file = target
        val ms = SystemClock.elapsedRealtime() - startedAt
        main.removeCallbacks(ticker)

        if (ms < MIN_MS) {
            teardown(r)
            file?.delete()
            emit(ev("tooShort"))
            return@post
        }

        val saved = runCatching { r.stop() }.isSuccess
        teardown(r)

        if (!saved || file == null || !file.exists() || file.length() == 0L) {
            file?.delete()
            emit(ev("error").put("message", "That recording didn't save"))
            return@post
        }

        emit(
            ev("saved")
                .put("file", file.name)
                .put("duration", (ms / 1000.0).roundToInt().coerceAtLeast(1))
                .put("bluetooth", viaBluetooth)
        )
    }

    /** Stop and throw away. */
    fun cancel() = main.post {
        if (arming && rec == null) { abort("cancelled"); return@post }
        val r = rec ?: return@post
        val file = target
        main.removeCallbacks(ticker)
        runCatching { r.stop() }
        teardown(r)
        file?.delete()
        emit(ev("cancelled"))
    }

    private fun abort(type: String) {
        session++
        arming = false
        clearRoute()
        emit(ev(type))
    }

    private fun fail(message: String) {
        val r = rec ?: return
        val file = target          // teardown clears it, so grab it first
        main.removeCallbacks(ticker)
        runCatching { r.stop() }
        teardown(r)
        file?.delete()
        emit(ev("error").put("message", message))
    }

    private fun teardown(r: MediaRecorder) {
        runCatching { r.release() }
        rec = null
        target = null
        clearRoute()
    }

    private fun clearRoute() {
        runCatching { audio.clearCommunicationDevice() }
    }

    // ----------------------------------------------------------------- meter

    /** Something alive for the UI to show, a few times a second. Square-rooted
     *  because a linear amplitude meter looks dead at speaking volume. */
    private val ticker = object : Runnable {
        override fun run() {
            val r = rec ?: return
            val amp = runCatching { r.maxAmplitude }.getOrDefault(0)
            val level = sqrt(min(amp, 20_000) / 20_000.0)
            emit(
                ev("level")
                    .put("level", level)
                    .put("ms", SystemClock.elapsedRealtime() - startedAt)
            )
            main.postDelayed(this, TICK_MS)
        }
    }

    private fun ev(type: String) = JSONObject().put("kind", "voice").put("type", type)

    private fun newName(): String =
        "vn_%s%03x.m4a".format(System.currentTimeMillis().toString(36), (0..4095).random())

    companion object {
        private const val ROUTE_TIMEOUT_MS = 2_000L
        private const val TICK_MS = 120L
        private const val MIN_MS = 800L

        /** The web layer names files; it must never be able to name a path. */
        private val SAFE = Regex("^vn_[a-z0-9]+\\.m4a$")
        fun safeName(name: String): Boolean = SAFE.matches(name)
    }
}
