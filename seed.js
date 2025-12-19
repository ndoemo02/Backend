import { createClient } from '@supabase/supabase-js'

// użyj zmiennych środowiskowych albo wklej wartości tymczasowo
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://ezemaacyyvbpjlagchds.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6ZW1hYWN5eXZicGpsYWdjaGRzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTc4NTUzNiwiZXhwIjoyMDc1MzYxNTM2fQ.YourServiceRoleKeyHere'
)

async function seedUsers() {
  const { data: biz, error: bizErr } = await supabase.auth.admin.createUser({
    email: 'biz@test.com',
    password: 'Test123!',
    email_confirm: true,
  })

  const { data: user, error: userErr } = await supabase.auth.admin.createUser({
    email: 'user@test.com',
    password: 'Test123!',
    email_confirm: true,
  })

  console.log({ biz, bizErr, user, userErr })
}

seedUsers()
