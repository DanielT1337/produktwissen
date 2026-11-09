// Firebase-Konfiguration – Werte aus der Firebase-Konsole einfügen:
// Projekteinstellungen → Allgemein → «Meine Apps» → Web-App → SDK-Konfiguration.
// Diese Werte sind nicht geheim und dürfen im Repository stehen.
export const firebaseConfig = {
  apiKey: "AIzaSyBpJkl4NyoviLlxSLM6PpifAXruH1Fh9vg",
  authDomain: "produktwissen-c1203.firebaseapp.com",
  projectId: "produktwissen-c1203",
  storageBucket: "produktwissen-c1203.firebasestorage.app",
  messagingSenderId: "456320831258",
  appId: "1:456320831258:web:67232061f9b42e49caa6a3",
};

// Google-Konto des Admins. Muss identisch sein mit ADMIN_EMAIL in firestore.rules.
export const ADMIN_EMAIL = "tiefenauer@veloplus.ch";
