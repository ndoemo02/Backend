// scripts/update-order-status.mjs
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// ID zamówienia, które wstawiłeś przed chwilą
const ORDER_ID = '2d23ad89-b44b-4f8d-b2f8-d6f89a239041'

let res = await supabase.from('orders').update({ status: 'accepted' }).eq('id', ORDER_ID).select()
console.log('-> accepted:', res.error ?? res.data)

res = await supabase.from('orders').update({ status: 'completed', payment_status: 'paid' }).eq('id', ORDER_ID).select()
console.log('-> completed+paid:', res.error ?? res.data)
