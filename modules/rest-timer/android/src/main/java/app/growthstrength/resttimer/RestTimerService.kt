package app.growthstrength.resttimer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator

/**
 * Runs for one rest at a time. The ongoing notification's countdown is drawn by the
 * system from its end time, so it stays right while the app sleeps; the progress bar
 * is refreshed each second while the screen is on. A short wake lock lets the end
 * alert fire on time with the screen off.
 */
class RestTimerService : Service() {
  data class Rest(val endsAt: Long, val totalMs: Long, val title: String, val detail: String, val doneTitle: String, val doneDetail: String)

  companion object {
    @Volatile var appVisible = true

    private const val ACTION_START = "app.growthstrength.resttimer.START"
    private const val RESTING_CHANNEL = "rest_countdown"
    private const val DONE_CHANNEL = "rest_over"
    private const val RESTING_ID = 4201
    private const val DONE_ID = 4202
    // Asks Android 16 and later to show the countdown as a Live Update in the status bar.
    private const val EXTRA_REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing"

    fun start(context: Context, rest: Rest) {
      val intent = Intent(context, RestTimerService::class.java).setAction(ACTION_START)
        .putExtra("endsAt", rest.endsAt)
        .putExtra("totalMs", rest.totalMs)
        .putExtra("title", rest.title)
        .putExtra("detail", rest.detail)
        .putExtra("doneTitle", rest.doneTitle)
        .putExtra("doneDetail", rest.doneDetail)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
    }

    /** Ends the countdown and clears a waiting rest-over alert. */
    fun stop(context: Context) {
      context.getSystemService(NotificationManager::class.java)?.cancel(DONE_ID)
      context.stopService(Intent(context, RestTimerService::class.java))
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private val tick = Runnable { update() }
  private var wakeLock: PowerManager.WakeLock? = null
  private var rest: Rest? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val next = intent?.takeIf { it.action == ACTION_START }?.let {
      Rest(it.getLongExtra("endsAt", 0L), it.getLongExtra("totalMs", 0L), it.getStringExtra("title") ?: "Resting",
        it.getStringExtra("detail") ?: "", it.getStringExtra("doneTitle") ?: "Rest's over", it.getStringExtra("doneDetail") ?: "")
    }
    createChannels()
    notifications().cancel(DONE_ID)
    rest = next
    // startForeground must follow every start request, even one that ends at once.
    val notification = resting(next ?: Rest(System.currentTimeMillis(), 1, "Resting", "", "", ""))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(RESTING_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(RESTING_ID, notification)
    }
    if (next == null || next.endsAt <= System.currentTimeMillis()) {
      finish(alert = false)
      return START_NOT_STICKY
    }
    holdWakeLock(next.endsAt)
    handler.removeCallbacks(tick)
    handler.post(tick)
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(tick)
    releaseWakeLock()
    super.onDestroy()
  }

  private fun update() {
    val current = rest ?: return finish(alert = false)
    val now = System.currentTimeMillis()
    if (now >= current.endsAt) return finish(alert = true)
    notifications().notify(RESTING_ID, resting(current))
    // Refresh the bar every second while someone can see it; with the screen off, only wake for the end.
    val interactive = getSystemService(PowerManager::class.java)?.isInteractive ?: true
    val wait = if (interactive) 1000 - now % 1000 else minOf(5000, current.endsAt - now)
    handler.postDelayed(tick, wait.coerceAtLeast(50))
  }

  private fun finish(alert: Boolean) {
    handler.removeCallbacks(tick)
    val ended = rest
    rest = null
    if (alert && ended != null) alertDone(ended)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
    releaseWakeLock()
  }

  private fun resting(current: Rest): Notification {
    val totalSeconds = (current.totalMs / 1000).toInt().coerceAtLeast(1)
    val leftSeconds = ((current.endsAt - System.currentTimeMillis() + 999) / 1000).toInt().coerceIn(0, totalSeconds)
    val elapsed = totalSeconds - leftSeconds
    val builder = builder(RESTING_CHANNEL)
      .setSmallIcon(R.drawable.rest_timer_icon)
      .setContentTitle(current.title)
      .setContentText(current.detail)
      .setContentIntent(openApp())
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(true)
      .setWhen(current.endsAt)
      .setUsesChronometer(true)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) builder.setChronometerCountDown(true)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA) {
      builder.setCategory(Notification.CATEGORY_WORKOUT)
        .setStyle(Notification.ProgressStyle()
          .setProgressSegments(listOf(Notification.ProgressStyle.Segment(totalSeconds)))
          .setProgress(elapsed))
        .addExtras(android.os.Bundle().apply { putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true) })
    } else {
      builder.setCategory(Notification.CATEGORY_STOPWATCH).setProgress(totalSeconds, elapsed, false)
    }
    return builder.build()
  }

  private fun alertDone(ended: Rest) {
    if (appVisible) {
      // The app is on screen and already shows the next set: a sound and a buzz are enough.
      val audio = getSystemService(AudioManager::class.java)
      if (audio?.ringerMode == AudioManager.RINGER_MODE_NORMAL) {
        RingtoneManager.getRingtone(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))?.play()
      }
      if (audio?.ringerMode != AudioManager.RINGER_MODE_SILENT) buzz()
      return
    }
    val notification = builder(DONE_CHANNEL)
      .setSmallIcon(R.drawable.rest_timer_icon)
      .setContentTitle(ended.doneTitle)
      .setContentText(ended.doneDetail)
      .setContentIntent(openApp())
      .setAutoCancel(true)
      .setCategory(Notification.CATEGORY_REMINDER)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .apply {
        // Before channels existed, sound and vibration were set on each notification.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
          @Suppress("DEPRECATION")
          setDefaults(Notification.DEFAULT_SOUND).setVibrate(donePattern).setPriority(Notification.PRIORITY_HIGH)
        }
      }
      .build()
    notifications().notify(DONE_ID, notification)
  }

  private val donePattern = longArrayOf(0, 180, 120, 180)

  private fun buzz() {
    val vibrator = getSystemService(Vibrator::class.java) ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      vibrator.vibrate(VibrationEffect.createWaveform(donePattern, -1))
    } else {
      @Suppress("DEPRECATION")
      vibrator.vibrate(donePattern, -1)
    }
  }

  private fun createChannels() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = notifications()
    // Default importance keeps the countdown expanded with the next set, rather than folded into "Silent"; it never makes a sound.
    manager.createNotificationChannel(NotificationChannel(RESTING_CHANNEL, "Rest timer", NotificationManager.IMPORTANCE_DEFAULT).apply {
      description = "The countdown while you rest between sets."
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
    })
    manager.createNotificationChannel(NotificationChannel(DONE_CHANNEL, "Rest over", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Tells you when it's time for the next set."
      enableVibration(true)
      vibrationPattern = donePattern
    })
  }

  private fun builder(channel: String): Notification.Builder =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, channel) else @Suppress("DEPRECATION") Notification.Builder(this)

  /** Brings GROWTH back where it was, like tapping its icon. */
  private fun openApp(): PendingIntent? {
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
    } ?: return null
    return PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun holdWakeLock(endsAt: Long) {
    releaseWakeLock()
    val timeout = (endsAt - System.currentTimeMillis()).coerceAtLeast(0) + 15_000
    wakeLock = getSystemService(PowerManager::class.java)?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GROWTH:rest")?.apply {
      setReferenceCounted(false)
      acquire(timeout)
    }
  }

  private fun releaseWakeLock() {
    wakeLock?.takeIf { it.isHeld }?.release()
    wakeLock = null
  }

  private fun notifications() = getSystemService(NotificationManager::class.java)
}
