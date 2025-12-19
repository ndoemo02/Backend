// scripts/get-customer-orders.mjs
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)

// ID klienta (user@test.com)
const CUSTOMER_ID = '0bb8b2d4-c1f0-4170-949c-912b37b26c3b'

const { data, error } = await supabase
  .from('orders')
  .select('id, restaurant, status, payment_status, total, created_at')
  .eq('customer', CUSTOMER_ID)
  .order('created_at', { ascending: false })

console.log({ error, orders: data })
