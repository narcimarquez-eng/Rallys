// Clasificación online (docs/ONLINE.md): la dirección del proyecto de Supabase y su clave pública «anon» (Project
// Settings → API). Esa clave va a la vista de todos en la página: es la pública, pensada para eso; las reglas de la
// tabla (online/supabase.sql) deciden qué se puede hacer con ella. NUNCA pongas aquí la clave «service_role».
// Vacío: sin clasificación online (las vueltas y el fantasma propios siguen funcionando en el navegador).
export const ONLINE = {
  url: '',   // p. ej. 'https://abcdefghijklmno.supabase.co'
  clave: ''  // la clave «anon public»
};
