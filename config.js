// Deployment settings for the iPad page. The only secret-ish value is the Places
// browser key, which is restricted to the Places API and this site's address.
// For local testing, ?api=http://localhost:PORT overrides API_URL and
// ?places=off turns off address autocomplete.
var CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbwrWSmYt8CQuC_GRcjaRkUIbrRBIWSbarocGDNlBpOEPT9lPyYKL1EnUyxRhLeLY-AJSQ/exec',
  PLACES_KEY: 'AIzaSyDaDVuuPHiMFhczsYYJ_FlX9GDBz0f1s2k',
  IDLE_SECONDS: 90
};
