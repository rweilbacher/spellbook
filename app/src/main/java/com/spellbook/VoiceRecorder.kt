package com.spellbook

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
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
    private val emit: (JSONObject) -> Unit,
    /** True while a recording is being armed or captured. The activity keeps
     *  the screen on for the duration — see the comment on onPause. */
    private val onActive: (Boolean) -> Unit = {}
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
    private var focus: AudioFocusRequest? = null
    private var priorMode = AudioManager.MODE_NORMAL
    private var routeLabel: String? = null

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
        onActive(true)
        // Exclusive focus for the duration. Not politeness: a notification
        // chime played through A2DP mid-note makes the headset renegotiate
        // profiles, and the capture drops out while it does.
        grabFocus()

        val bt = if (preferBluetooth) bluetoothMic() else null
        if (bt == null) { begin(my, null); return@post }

        // Selecting the device is not enough on its own. The framework only
        // brings the call link up when there is a communication use case in
        // progress, and in MODE_NORMAL there isn't one — so the device reads
        // back as selected, the headset never leaves stereo, and capture
        // quietly comes off the phone's own microphone instead. This is the
        // line that actually makes the headset the microphone.
        priorMode = audio.mode
        runCatching { audio.mode = AudioManager.MODE_IN_COMMUNICATION }

        val took = runCatching { audio.setCommunicationDevice(bt) }.getOrDefault(false)
        if (!took) { restoreMode(); begin(my, null); return@post }

        // The link takes a moment to come up. Capturing before it does loses
        // the first second or two, which on a note this short is most of it.
        emit(ev("routing"))
        awaitRoute(my, bt, SystemClock.elapsedRealtime() + ROUTE_TIMEOUT_MS)
    }

    private fun awaitRoute(my: Int, dev: AudioDeviceInfo, deadline: Long) {
        if (my != session) { arming = false; clearRoute(); return }
        if (audio.communicationDevice?.id == dev.id) {
            viaBluetooth = true
            // Selected is not the same as carrying audio. The headset has to
            // drop out of stereo and bring up the call link, and the first
            // moments of that are silence — which is what lands at the front
            // of the file if we start the encoder the instant Android says
            // the device is chosen.
            main.postDelayed({ begin(my, dev) }, SETTLE_MS)
            return
        }
        if (SystemClock.elapsedRealtime() >= deadline) {
            // Headset connected but the link won't come up. Better a note
            // recorded on the built-in mic than no note.
            clearRoute()
            restoreMode()
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
            // VOICE_RECOGNITION, not VOICE_COMMUNICATION. Both follow the
            // call-audio route, which is what a headset mic needs, but
            // VOICE_COMMUNICATION is tuned for phone calls: echo cancellation,
            // automatic gain, aggressive noise suppression. Pointed at someone
            // speaking quietly it gates the quiet parts as noise, and the note
            // comes back with holes in it. VOICE_RECOGNITION exists to hand
            // speech engines something unprocessed, which is exactly what a
            // recording wants.
            r.setAudioSource(
                if (dev != null) MediaRecorder.AudioSource.VOICE_RECOGNITION
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
            clearRoute(); dropFocus(); onActive(false)
            emit(ev("error").put("message", "Couldn't start recording"))
            return
        }

        rec = r
        target = file
        startedAt = SystemClock.elapsedRealtime()
        routeLabel = null
        // What we asked for; the ticker reports what we actually got.
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
        clearRoute(); dropFocus(); onActive(false)
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
        clearRoute(); dropFocus(); onActive(false)
    }

    /** Hand the headset back to stereo promptly — while this is set, the
     *  headset is in call mode for the whole phone, not just for us. */
    private fun clearRoute() {
        runCatching { audio.clearCommunicationDevice() }
        restoreMode()
    }

    /** MODE_IN_COMMUNICATION is a whole-phone state. Leaving it set would keep
     *  the headset in call mode long after the note is finished. */
    private fun restoreMode() {
        if (audio.mode == AudioManager.MODE_IN_COMMUNICATION) {
            runCatching { audio.mode = priorMode }
        }
    }

    private fun grabFocus() {
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .build()
        focus = req
        runCatching { audio.requestAudioFocus(req) }
    }

    private fun dropFocus() {
        focus?.let { runCatching { audio.abandonAudioFocusRequest(it) } }
        focus = null
    }

    // ----------------------------------------------------------------- meter

    /** Something alive for the UI to show, a few times a second. Square-rooted
     *  because a linear amplitude meter looks dead at speaking volume. */
    private val ticker = object : Runnable {
        override fun run() {
            val r = rec ?: return

            // The ground truth, and the only honest answer to "is it using the
            // headset?" — what we asked for and what the audio stack actually
            // gave us are different questions. Reported whenever it changes,
            // which also catches a route moving out from under a note midway.
            val now = label(runCatching { r.routedDevice }.getOrNull())
            if (now != routeLabel) {
                routeLabel = now
                emit(ev("route").put("via", now))
            }

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

    private fun label(d: AudioDeviceInfo?): String = when (d?.type) {
        null -> "…"
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "the headset"
        AudioDeviceInfo.TYPE_BLE_HEADSET -> "the headset, LE Audio"
        AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_USB_HEADSET -> "a wired headset"
        AudioDeviceInfo.TYPE_BUILTIN_MIC -> "the phone's microphone"
        else -> "another microphone"
    }

    private fun ev(type: String) = JSONObject().put("kind", "voice").put("type", type)

    private fun newName(): String =
        "vn_%s%03x.m4a".format(System.currentTimeMillis().toString(36), (0..4095).random())

    companion object {
        private const val ROUTE_TIMEOUT_MS = 2_000L
        /** Between "Android says the headset is selected" and "the headset is
         *  actually carrying audio". Tuned by ear; too small and the note
         *  opens with silence, too large and you're waiting for no reason. */
        private const val SETTLE_MS = 450L
        private const val TICK_MS = 120L
        private const val MIN_MS = 800L

        /** The web layer names files; it must never be able to name a path. */
        private val SAFE = Regex("^vn_[a-z0-9]+\\.m4a$")
        fun safeName(name: String): Boolean = SAFE.matches(name)
    }
}
