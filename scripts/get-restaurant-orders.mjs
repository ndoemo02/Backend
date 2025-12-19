// scripts/get-restaurant-orders.mjs
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)

// ID restauracji „Złota Łyżka”
const RESTAURANT_ID = '08493070-2ad2-4c6e-aada-3a0d1c36fbc0'

const { data, error } = await supabase
  .from('orders')
  .select('id, customer, status, payment_status, total, created_at')
  .eq('restaurant', RESTAURANT_ID)
  .order('created_at', { ascending: false })

console.log({ error, orders: data })
