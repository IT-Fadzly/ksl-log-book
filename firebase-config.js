/* Firebase web config — used by the admin page and by the push worker.
   From the Firebase console: Project settings → General → Your apps → Web
   app → "SDK setup and configuration" → Config. These values identify the
   project; they are not secrets and are meant to be public.

   The VAPID key is under Project settings → Cloud Messaging → Web Push
   certificates → Key pair. It is public too.

   The private half — the service account — never goes here. It lives in
   Apps Script's Script properties as FCM_SERVICE_ACCOUNT. */
self.FIREBASE_CONFIG = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: ''
};
self.FIREBASE_VAPID_KEY = '';
