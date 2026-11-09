// Zentrale Firebase-Initialisierung. Die SDK-Version steht nur hier.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initializeFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig as liveConfig, ADMIN_EMAIL } from "./firebase-config.js";

// Lokaler Test mit dem Firebase-Emulator: http://localhost:8000/?emulator (siehe README)
const useEmulator = ["localhost", "127.0.0.1"].includes(location.hostname) &&
  new URLSearchParams(location.search).has("emulator");
const firebaseConfig = useEmulator
  ? { apiKey: "demo-key", authDomain: "localhost", projectId: "demo-produktwissen" }
  : liveConfig;

export {
  onAuthStateChanged, signInAnonymously, signInWithPopup, signInWithRedirect,
  getRedirectResult, GoogleAuthProvider, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

export {
  doc, collection, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, writeBatch, serverTimestamp, deleteField,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export const isConfigured = !String(firebaseConfig.apiKey).startsWith("DEIN_");

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
if (useEmulator) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
export { ADMIN_EMAIL };

export function isAdminUser(user) {
  return !!user && !user.isAnonymous &&
    String(user.email || "").toLowerCase() === ADMIN_EMAIL.toLowerCase();
}
