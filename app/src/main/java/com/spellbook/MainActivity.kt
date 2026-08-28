package com.spellbook

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.WindowCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream

/**
 * A thin shell. All of the app is the web bundle in assets/; this class exists
 * to host it on a real origin, give it a file to write to, and wire up the
 * things a web page can't do for itself: the back button, the file picker, the
 * microphone, and the folder backups get copied into.
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private var pendingFiles: ValueCallback<Array<Uri>>? = null
    private lateinit var picker: ActivityResultLauncher<Array<String>>
    private lateinit var micPermission: ActivityResultLauncher<String>
    private lateinit var notifyPermission: ActivityResultLauncher<String>
    private lateinit var folderPicker: ActivityResultLauncher<Uri?>

    lateinit var voice: VoiceRecorder
        private set
    lateinit var backups: Backups
        private set

    private var pendingBluetooth = false

    /**
     * Where a reminder wants the page to land. Set before the WebView exists, so
     * the page collects it for itself at boot rather than being told; written on
     * the main thread and read from a binder thread, hence volatile.
     */
    @Volatile
    private var pendingOpen: String? = null

    private val mediaDir: File get() = File(filesDir, "media")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Draw behind the system bars; the CSS uses env(safe-area-inset-*) to compensate.
        WindowCompat.setDecorFitsSystemWindows(window, false)

        pendingOpen = intent?.getStringExtra(EXTRA_OPEN)

        // Alarms don't survive a force-stop, and the receiver only hears about
        // reboots and clock changes. Re-arming on every launch costs three
        // AlarmManager calls and closes the last gap.
        Reminders.arm(this)

        mediaDir.mkdirs()
        backups = Backups(this)
        voice = VoiceRecorder(this, { emit(it) }) { active ->
            // A screen that times out mid-note is a note that stops mid-note:
            // onPause below saves what it has, and even without that, Android
            // mutes the microphone for an app it considers backgrounded. The
            // honest fix is a foreground service; keeping the screen lit for
            // the length of a voice note is the proportionate one.
            runOnUiThread {
                if (active) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }

        picker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            pendingFiles?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
            pendingFiles = null
        }

        // Asked for the first time the mic is tapped, never at launch.
        micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) voice.start(pendingBluetooth)
            else emit(JSONObject().put("kind", "voice").put("type", "denied"))
        }

        // Asked the first time a reminder time is set, never at launch. A book
        // with no reminders never sees this prompt at all.
        notifyPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) Reminders.arm(this)
            emit(JSONObject().put("kind", "notify").put("granted", granted))
        }

        folderPicker = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
            val ev = JSONObject().put("kind", "backup").put("type", "folder")
            if (uri != null) {
                backups.remember(uri)
                ev.put("message", "Backups will go to " + backups.label())
            }
            emit(ev)
        }

        // Serving assets over https://appassets.androidplatform.net rather than
        // file:// gives the page a proper secure origin, so storage behaves.
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/media/", VoiceNotePathHandler())
            .build()

        web = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(0xFF101216.toInt())   // no white flash on cold start

            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.textZoom = 100                  // ignore system font scaling; the type is already tuned

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView, request: WebResourceRequest
                ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)

                override fun shouldOverrideUrlLoading(
                    view: WebView, request: WebResourceRequest
                ): Boolean {
                    val url = request.url
                    if (url.host == "appassets.androidplatform.net") return false
                    // Source links (tweets and such) open in the real browser.
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                    return true
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView,
                    callback: ValueCallback<Array<Uri>>,
                    params: FileChooserParams
                ): Boolean {
                    pendingFiles?.onReceiveValue(null)
                    pendingFiles = callback
                    return runCatching {
                        picker.launch(arrayOf("application/json", "text/plain", "*/*")); true
                    }.getOrElse {
                        pendingFiles = null; false
                    }
                }
            }

            addJavascriptInterface(SpellbookBridge(this@MainActivity), "Android")
        }

        setContentView(web)
        web.loadUrl("https://appassets.androidplatform.net/assets/index.html")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("window.appBack ? window.appBack() : false") { handled ->
                    if (handled != "true") finish()
                }
            }
        })
    }

    /**
     * A reminder tapped while the app is already up. `singleTask` means this,
     * not a second onCreate — and by now the page is loaded, so it can simply
     * be told rather than leaving something for it to collect.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val target = intent.getStringExtra(EXTRA_OPEN) ?: return
        pendingOpen = target
        emit(JSONObject().put("kind", "open").put("target", target))
    }

    // --------------------------------------------------- called by the bridge

    /** Read once and cleared: a reminder opens the draw the time it's tapped,
     *  not again on the next reload. */
    fun takeOpenRequest(): String {
        val target = pendingOpen
        pendingOpen = null
        return target ?: ""
    }

    fun requestNotifyPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            emit(JSONObject().put("kind", "notify").put("granted", true))
            return
        }
        runCatching { notifyPermission.launch(Manifest.permission.POST_NOTIFICATIONS) }
            .onFailure { emit(JSONObject().put("kind", "notify").put("granted", false)) }
    }

    /** The way back once Android has stopped asking — two refusals and the
     *  prompt never appears again, and only settings can undo that. */
    fun openNotificationSettings() {
        runCatching {
            startActivity(
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            )
        }.onFailure {
            runCatching {
                startActivity(
                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                        .setData(Uri.fromParts("package", packageName, null))
                )
            }
        }
    }

    fun startVoiceNote(preferBluetooth: Boolean) {
        pendingBluetooth = preferBluetooth
        if (voice.hasPermission()) {
            voice.start(preferBluetooth)
        } else {
            runCatching { micPermission.launch(Manifest.permission.RECORD_AUDIO) }
                .onFailure { emit(JSONObject().put("kind", "voice").put("type", "denied")) }
        }
    }

    fun pickBackupFolder() {
        runCatching { folderPicker.launch(null) }
    }

    /** The one channel back into the page. Everything asynchronous — routing,
     *  levels, a finished recording, a folder choice — arrives this way. */
    fun emit(payload: JSONObject) {
        runOnUiThread {
            if (!::web.isInitialized) return@runOnUiThread
            val arg = JSONObject.quote(payload.toString())
            runCatching {
                web.evaluateJavascript("window.onNative && window.onNative($arg)", null)
            }
        }
    }

    /**
     * Serves files/media over the same origin as the assets, so a voice note is
     * an ordinary <audio> tag and nothing has to loosen file access. The MIME
     * type is stated rather than guessed — the asset loader's guesser doesn't
     * know .m4a and falls back to text/plain, which the media stack refuses to
     * play. No range support, so seeking within a note won't work; at this
     * length that's fine, and it's the reason to change approach if voice notes
     * ever get long.
     */
    private inner class VoiceNotePathHandler : WebViewAssetLoader.PathHandler {
        override fun handle(path: String): WebResourceResponse {
            val file = File(mediaDir, path)
            if (!VoiceRecorder.safeName(path) || !file.isFile) return notFound()
            return runCatching {
                WebResourceResponse(
                    "audio/mp4", null, 200, "OK",
                    mapOf(
                        "Content-Length" to file.length().toString(),
                        "Cache-Control" to "no-store"
                    ),
                    FileInputStream(file)
                )
            }.getOrElse { notFound() }
        }

        private fun notFound() = WebResourceResponse(
            "text/plain", "utf-8", 404, "Not Found", emptyMap(), null
        )
    }

    // ------------------------------------------------------------- lifecycle

    /**
     * Coming back from Android's own notification settings is the one way the
     * answer changes without us hearing about it — so the page is told, quietly,
     * rather than going on insisting it's blocked.
     */
    override fun onResume() {
        super.onResume()
        if (::web.isInitialized) {
            emit(
                JSONObject()
                    .put("kind", "notify")
                    .put("granted", Reminders.canPost(this))
                    .put("quiet", true)
            )
        }
    }

    override fun onPause() {
        super.onPause()
        // Leaving the app finishes a note rather than losing it.
        if (voice.isRecording) voice.stop()
        // Nothing else belongs here. There was an evaluateJavascript("void 0")
        // under a comment claiming it flushed WebView's caches; it flushed
        // nothing. The book is written on every edit, so leaving the app has
        // never had anything to save.
    }

    override fun onDestroy() {
        if (voice.isRecording) voice.cancel()
        web.destroy()
        super.onDestroy()
    }

    companion object {
        /** Which screen the page should land on, when something other than the
         *  launcher opened the app. */
        const val EXTRA_OPEN = "com.spellbook.OPEN"
        const val OPEN_DRAW = "draw"

        /** Followed by a spell id: land on that spell's detail sheet rather
         *  than a screen. What the widget asks for when it's tapped. */
        const val OPEN_SPELL_PREFIX = "spell:"
    }
}
