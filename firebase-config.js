/* Firebase web config — used by the admin page and by the push worker.
   From the Firebase console: Project settings → General → Your apps → Web
   app → "SDK setup and configuration" → Config. These values identify the
   project; they are not secrets and are meant to be public.

   The VAPID key is under Project settings → Cloud Messaging → Web Push
   certificates → Key pair. It is public too.

   The private half — the service account — never goes here. It lives in
   Apps Script's Script properties as FCM_SERVICE_ACCOUNT. */
self.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCQfsrAy-_Ti1HWtP9tPLTSQ3vlutabGaQ',
  authDomain: 'labmobile-89bfd.firebaseapp.com',
  projectId: 'labmobile-89bfd',
  storageBucket: 'labmobile-89bfd.firebasestorage.app',
  messagingSenderId: '622350420694',
  appId: '1:622350420694:web:e84c2e3331a64075b55777'
};
self.FIREBASE_VAPID_KEY = 'BP7jAt107RE1k1lMAomjGs27VLo-IfqD3BrmCcwAu8C-5HAnpxUGDVIMJT6uQjWAjxFz8nM0n0a-0BNJoBIsz28';
