// Fill these in from your Supabase project: Project Settings -> API
// SUPABASE_URL      = "Project URL"
// SUPABASE_ANON_KEY = "anon public" key (do NOT use the service_role key here)
module.exports = {
  // KOEL project: customers, products, documents, settings.
  SUPABASE_URL: process.env.HV_KOEL_SUPABASE_URL || 'https://wohbeyxvszanfvrngplq.supabase.co',
  SUPABASE_ANON_KEY: process.env.HV_KOEL_SUPABASE_ANON_KEY || 'sb_publishable_gFvWcxQxv1WjajonYE34Rg_Sgl4n4TN',
  // KSB project: only its document-number counters are used, so KSB and KOEL
  // documents share one running series.
  NUMBERING_SUPABASE_URL: process.env.HV_SUPABASE_URL || 'https://hebmgkykzjhcwetnsomk.supabase.co',
  NUMBERING_SUPABASE_ANON_KEY: process.env.HV_SUPABASE_ANON_KEY || 'sb_publishable_ayUO1uOIIcRPD2C8S05VgA_7jid6ZCH'
};
