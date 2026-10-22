// Fill these in from your Supabase project: Project Settings -> API
// SUPABASE_URL      = "Project URL"
// SUPABASE_ANON_KEY = "anon public" key (do NOT use the service_role key here)
module.exports = {
  SUPABASE_URL: process.env.HV_KOEL_SUPABASE_URL || 'PASTE_KOEL_SUPABASE_URL_HERE',
  SUPABASE_ANON_KEY: process.env.HV_KOEL_SUPABASE_ANON_KEY || 'PASTE_KOEL_SUPABASE_ANON_KEY_HERE'
};
