import { PublicClientApplication, Configuration, LogLevel } from '@azure/msal-browser'

export const msalConfig: Configuration = {
  auth: {
    clientId: import.meta.env.VITE_AZURE_CLIENT_ID ?? '',
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_TENANT_ID ?? 'common'}`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'localStorage',
    storeAuthStateInCookie: true,
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return
        if (level === LogLevel.Error) console.error(message)
        if (level === LogLevel.Warning) console.warn(message)
      },
      logLevel: LogLevel.Warning,
    },
  },
}

export const loginRequest = {
  scopes: [
    'openid',
    'profile',
    'offline_access',
    'User.Read',
  ],
}

/**
 * Scopes used to call the EasyAzure API. The scope identifier is
 * `api://<api-client-id>/access_as_user`, defined on the Entra app registration.
 * See: https://learn.microsoft.com/entra/identity-platform/scopes-oidc
 */
export const easyAzureApiScopes = {
  scopes: [
    `api://${import.meta.env.VITE_AZURE_CLIENT_ID}/access_as_user`,
  ],
}

export const azureManagementScopes = {
  scopes: ['https://management.azure.com/.default'],
}

export const msalInstance = new PublicClientApplication(msalConfig)
