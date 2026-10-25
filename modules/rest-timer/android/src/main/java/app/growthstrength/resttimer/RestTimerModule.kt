package app.growthstrength.resttimer

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Starts and stops the rest countdown notification from flow mode. */
class RestTimerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RestTimer")

    // While GROWTH is on screen the rest view shows the end itself, so the alert only buzzes.
    OnActivityEntersForeground { RestTimerService.appVisible = true }
    OnActivityEntersBackground { RestTimerService.appVisible = false }

    Function("start") { endsAt: Double, totalSeconds: Double, title: String, detail: String, doneTitle: String, doneDetail: String ->
      appContext.reactContext?.let {
        RestTimerService.start(it, RestTimerService.Rest(endsAt.toLong(), (totalSeconds * 1000).toLong(), title, detail, doneTitle, doneDetail))
      }
    }

    Function("stop") {
      appContext.reactContext?.let { RestTimerService.stop(it) }
    }
  }
}
