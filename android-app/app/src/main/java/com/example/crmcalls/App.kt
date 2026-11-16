package com.example.crmcalls

import android.app.Application

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifs.createChannels(this)
        if (Prefs.get(this).paired) {
            Work.schedulePeriodic(this)
            CallMonitorService.start(this)
        }
    }
}
