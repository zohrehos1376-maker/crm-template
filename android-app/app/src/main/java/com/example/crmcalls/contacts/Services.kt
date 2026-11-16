package com.example.crmcalls.contacts

import android.accounts.AbstractAccountAuthenticator
import android.accounts.Account
import android.accounts.AccountAuthenticatorResponse
import android.app.Service
import android.content.AbstractThreadedSyncAdapter
import android.content.ContentProviderClient
import android.content.Context
import android.content.Intent
import android.content.SyncResult
import android.os.Bundle
import android.os.IBinder

/** احراز هویت ساختگی — فقط برای این‌که حساب «CRM DEMO CRM» در گوشی وجود داشته باشد */
class AuthenticatorService : Service() {
    private lateinit var auth: Authenticator

    override fun onCreate() {
        super.onCreate()
        auth = Authenticator(this)
    }

    override fun onBind(intent: Intent?): IBinder? = auth.iBinder
}

class Authenticator(ctx: Context) : AbstractAccountAuthenticator(ctx) {
    override fun editProperties(response: AccountAuthenticatorResponse?, accountType: String?): Bundle? = null

    override fun addAccount(
        response: AccountAuthenticatorResponse?,
        accountType: String?,
        authTokenType: String?,
        requiredFeatures: Array<out String>?,
        options: Bundle?
    ): Bundle? = null

    override fun confirmCredentials(response: AccountAuthenticatorResponse?, account: Account?, options: Bundle?): Bundle? = null

    override fun getAuthToken(
        response: AccountAuthenticatorResponse?,
        account: Account?,
        authTokenType: String?,
        options: Bundle?
    ): Bundle? = null

    override fun getAuthTokenLabel(authTokenType: String?): String? = null

    override fun updateCredentials(
        response: AccountAuthenticatorResponse?,
        account: Account?,
        authTokenType: String?,
        options: Bundle?
    ): Bundle? = null

    override fun hasFeatures(response: AccountAuthenticatorResponse?, account: Account?, features: Array<out String>?): Bundle? = null
}

/** همگام‌ساز مخاطبین — کار اصلی را ContactsSync انجام می‌دهد */
class ContactsSyncService : Service() {
    companion object {
        private val lock = Any()
        private var adapter: ContactsSyncAdapter? = null
    }

    override fun onCreate() {
        super.onCreate()
        synchronized(lock) {
            if (adapter == null) adapter = ContactsSyncAdapter(applicationContext)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = adapter?.syncAdapterBinder
}

class ContactsSyncAdapter(ctx: Context) : AbstractThreadedSyncAdapter(ctx, true) {
    override fun onPerformSync(
        account: Account?,
        extras: Bundle?,
        authority: String?,
        provider: ContentProviderClient?,
        syncResult: SyncResult?
    ) {
        try {
            ContactsSync.run(context)
        } catch (e: Exception) {
        }
    }
}
