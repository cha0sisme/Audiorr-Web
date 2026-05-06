declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  interface Window {
    /** Runtime backend URL inyectada por env.js (reescrito por el contenedor Docker). */
    __AUDIORR_BACKEND_URL__?: string;
  }
}

export {};
