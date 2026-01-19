/**
 * Admin API Router (READ-ONLY)
 * ═══════════════════════════════════════════════════════════════════════════
 * Provides READ-ONLY endpoints for Admin/Business panels.
 * 
 * CONSTRAINTS:
 * - NO mutations (all GET)
 * - NO AI/NLU logic
 * - NO session modifications
 * - Uses existing Supabase tables only
 * 
 * Endpoints:
 * 1. GET /api/admin/restaurants
 * 2. GET /api/admin/restaurants/:id/menu
 * 3. GET /api/admin/conversations
 * 4. GET /api/admin/conversations/:sessionId
 * 5. GET /api/admin/orders
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import { supabase } from '../_supabase.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// AUTH MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════

function requireAdminToken(req, res, next) {
    const token = req.headers['x-admin-token'] || req.headers['X-Admin-Token'];
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    next();
}

// Apply auth to all routes
router.use(requireAdminToken);

// ═══════════════════════════════════════════════════════════════════════════
// 1. GET /restaurants - List all restaurants
// ═══════════════════════════════════════════════════════════════════════════

router.get('/restaurants', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const offset = parseInt(req.query.offset) || 0;

        const { data, error, count } = await supabase
            .from('restaurants')
            .select('id, name, address, city, is_active, partner_mode, created_at, updated_at', { count: 'exact' })
            .order('updated_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        return res.json({
            ok: true,
            data: data || [],
            pagination: {
                total: count || 0,
                limit,
                offset,
                hasMore: (offset + limit) < (count || 0)
            }
        });
    } catch (err) {
        console.error('[AdminRouter] GET /restaurants error:', err.message);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. GET /restaurants/:id/menu - Menu for specific restaurant
// ═══════════════════════════════════════════════════════════════════════════

router.get('/restaurants/:id/menu', async (req, res) => {
    try {
        const restaurantId = req.params.id;
        if (!restaurantId) {
            return res.status(400).json({ ok: false, error: 'missing_restaurant_id' });
        }

        // Fetch restaurant info
        const { data: restaurant, error: restErr } = await supabase
            .from('restaurants')
            .select('id, name, address, city')
            .eq('id', restaurantId)
            .single();

        if (restErr || !restaurant) {
            return res.status(404).json({ ok: false, error: 'restaurant_not_found' });
        }

        // Fetch menu items (try menu_items_v2 first, fallback to menu_items)
        let menuItems = [];
        let menuError = null;

        const { data: v2Items, error: v2Err } = await supabase
            .from('menu_items_v2')
            .select('id, name, description, price_pln, category, available, created_at')
            .eq('restaurant_id', restaurantId)
            .order('category', { ascending: true })
            .order('name', { ascending: true });

        if (!v2Err && v2Items?.length > 0) {
            menuItems = v2Items.map(item => ({
                id: item.id,
                name: item.name,
                description: item.description,
                price: item.price_pln,
                category: item.category,
                available: item.available !== false,
                created_at: item.created_at
            }));
        } else {
            // Fallback to legacy table
            const { data: legacyItems, error: legacyErr } = await supabase
                .from('menu_items')
                .select('id, name, description, price, category')
                .eq('restaurant_id', restaurantId)
                .order('name', { ascending: true });

            if (!legacyErr && legacyItems) {
                menuItems = legacyItems.map(item => ({
                    id: item.id,
                    name: item.name,
                    description: item.description,
                    price: item.price,
                    category: item.category,
                    available: true
                }));
            } else {
                menuError = legacyErr;
            }
        }

        // Group by category
        const categories = {};
        for (const item of menuItems) {
            const cat = item.category || 'Inne';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push(item);
        }

        return res.json({
            ok: true,
            restaurant: {
                id: restaurant.id,
                name: restaurant.name,
                address: restaurant.address,
                city: restaurant.city
            },
            menu: {
                items: menuItems,
                byCategory: categories,
                totalItems: menuItems.length
            }
        });
    } catch (err) {
        console.error('[AdminRouter] GET /restaurants/:id/menu error:', err.message);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. GET /conversations - List conversations
// ═══════════════════════════════════════════════════════════════════════════

router.get('/conversations', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const offset = parseInt(req.query.offset) || 0;
        const status = req.query.status; // Optional filter: 'active', 'closed'

        let query = supabase
            .from('conversations')
            .select('*', { count: 'exact' })
            .order('updated_at', { ascending: false, nullsFirst: false })
            .range(offset, offset + limit - 1);

        if (status) {
            query = query.eq('status', status);
        }

        const { data, error, count } = await query;

        if (error) throw error;

        // Enrich with stage info
        const enriched = (data || []).map(conv => {
            let stage = 1;
            let stageName = 'started';

            // Heuristics based on metadata
            const meta = conv.metadata || {};
            if (conv.status === 'closed') {
                stage = 4;
                stageName = 'completed';
            } else if (meta.pendingOrder) {
                stage = 3;
                stageName = 'ordering';
            } else if (meta.lastRestaurant || meta.currentRestaurant) {
                stage = 2;
                stageName = 'browsing';
            }

            return {
                id: conv.id,
                sessionId: conv.session_id,
                status: conv.status,
                stage,
                stageName,
                createdAt: conv.created_at,
                updatedAt: conv.updated_at
            };
        });

        return res.json({
            ok: true,
            data: enriched,
            pagination: {
                total: count || 0,
                limit,
                offset,
                hasMore: (offset + limit) < (count || 0)
            }
        });
    } catch (err) {
        console.error('[AdminRouter] GET /conversations error:', err.message);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. GET /conversations/:sessionId - Single conversation with timeline
// ═══════════════════════════════════════════════════════════════════════════

router.get('/conversations/:sessionId', async (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        if (!sessionId) {
            return res.status(400).json({ ok: false, error: 'missing_session_id' });
        }

        // Try to find by session_id or id
        let conv = null;
        let convError = null;

        // Try session_id first
        const { data: bySession, error: e1 } = await supabase
            .from('conversations')
            .select('*')
            .eq('session_id', sessionId)
            .single();

        if (!e1 && bySession) {
            conv = bySession;
        } else {
            // Try by id
            const { data: byId, error: e2 } = await supabase
                .from('conversations')
                .select('*')
                .eq('id', sessionId)
                .single();

            if (!e2 && byId) {
                conv = byId;
            } else {
                convError = e2 || e1;
            }
        }

        if (!conv) {
            return res.status(404).json({ ok: false, error: 'conversation_not_found' });
        }

        // Fetch timeline events
        const { data: events, error: eventsError } = await supabase
            .from('conversation_events')
            .select('id, event_type, event_status, workflow_step, payload, created_at')
            .eq('conversation_id', conv.id)
            .order('created_at', { ascending: true });

        if (eventsError) {
            console.warn('[AdminRouter] Events fetch warning:', eventsError.message);
        }

        // Build timeline
        const timeline = (events || []).map(event => ({
            id: event.id,
            type: event.event_type,
            status: event.event_status,
            step: event.workflow_step,
            payload: event.payload,
            timestamp: event.created_at
        }));

        return res.json({
            ok: true,
            data: {
                id: conv.id,
                sessionId: conv.session_id,
                status: conv.status,
                metadata: conv.metadata,
                createdAt: conv.created_at,
                updatedAt: conv.updated_at,
                closedAt: conv.closed_at || null,
                closedReason: conv.closed_reason || null,
                timeline
            }
        });
    } catch (err) {
        console.error('[AdminRouter] GET /conversations/:sessionId error:', err.message);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. GET /orders - List orders
// ═══════════════════════════════════════════════════════════════════════════

router.get('/orders', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const offset = parseInt(req.query.offset) || 0;
        const status = req.query.status; // Optional: 'pending', 'accepted', 'completed', 'cancelled'
        const restaurantId = req.query.restaurant_id;

        let query = supabase
            .from('orders')
            .select(`
                id,
                restaurant_id,
                restaurant_name,
                user_id,
                items,
                total_price,
                status,
                customer_name,
                customer_phone,
                delivery_address,
                notes,
                created_at
            `, { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (status) {
            query = query.eq('status', status);
        }
        if (restaurantId) {
            query = query.eq('restaurant_id', restaurantId);
        }

        const { data, error, count } = await query;

        if (error) throw error;

        // Normalize items format
        const orders = (data || []).map(order => ({
            id: order.id,
            restaurantId: order.restaurant_id,
            restaurantName: order.restaurant_name,
            userId: order.user_id,
            items: order.items || [],
            totalPrice: order.total_price,
            status: order.status,
            customer: {
                name: order.customer_name,
                phone: order.customer_phone,
                address: order.delivery_address
            },
            notes: order.notes,
            createdAt: order.created_at
        }));

        return res.json({
            ok: true,
            data: orders,
            pagination: {
                total: count || 0,
                limit,
                offset,
                hasMore: (offset + limit) < (count || 0)
            }
        });
    } catch (err) {
        console.error('[AdminRouter] GET /orders error:', err.message);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. GET /orders/:id - Single order details
// ═══════════════════════════════════════════════════════════════════════════

router.get('/orders/:id', async (req, res) => {
    try {
        const orderId = req.params.id;
        if (!orderId) {
            return res.status(400).json({ ok: false, error: 'missing_order_id' });
        }

        const { data: order, error } = await supabase
            .from('orders')
            .select(`
                *,
                restaurants:restaurant_id (
                    name,
                    address,
                    city
                )
            `)
            .eq('id', orderId)
            .single();

        if (error || !order) {
            return res.status(404).json({ ok: false, error: 'order_not_found' });
        }

        return res.json({
            ok: true,
            data: {
                id: order.id,
                restaurantId: order.restaurant_id,
                restaurant: order.restaurants,
                userId: order.user_id,
                items: order.items || [],
                totalPrice: order.total_price,
                status: order.status,
                customer: {
                    name: order.customer_name,
                    phone: order.customer_phone,
                    address: order.delivery_address
                },
                notes: order.notes,
                createdAt: order.created_at
            }
        });
    } catch (err) {
        console.error('[AdminRouter] GET /orders/:id error:', err.message);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

export default router;
