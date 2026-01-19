# Admin API (READ-ONLY)

## Overview

Clean, read-only API for Admin/Business panels. All endpoints require `x-admin-token` header.

## Base URL
```
http://localhost:3000/api/admin
```

## Authentication
All requests must include:
```
x-admin-token: <ADMIN_TOKEN>
```

---

## Endpoints

### 1. GET /restaurants

List all restaurants with pagination.

**Query Parameters:**
- `limit` (optional, default: 100, max: 500)
- `offset` (optional, default: 0)

**Example Request:**
```bash
curl -H "x-admin-token: YOUR_TOKEN" http://localhost:3000/api/admin/restaurants?limit=10
```

**Example Response:**
```json
{
  "ok": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Pizzeria Monte Carlo",
      "address": "ul. Bytomska 123",
      "city": "Piekary Śląskie",
      "is_active": true,
      "partner_mode": "premium",
      "created_at": "2024-01-15T10:00:00Z",
      "updated_at": "2024-06-20T14:30:00Z"
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "name": "Klaps Burgers",
      "address": "ul. Krakowska 45",
      "city": "Piekary Śląskie",
      "is_active": true,
      "partner_mode": "basic",
      "created_at": "2024-02-01T09:00:00Z",
      "updated_at": "2024-06-19T11:00:00Z"
    }
  ],
  "pagination": {
    "total": 42,
    "limit": 10,
    "offset": 0,
    "hasMore": true
  }
}
```

---

### 2. GET /restaurants/:id/menu

Get menu for a specific restaurant, grouped by category.

**Example Request:**
```bash
curl -H "x-admin-token: YOUR_TOKEN" http://localhost:3000/api/admin/restaurants/550e8400-e29b-41d4-a716-446655440000/menu
```

**Example Response:**
```json
{
  "ok": true,
  "restaurant": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Pizzeria Monte Carlo",
    "address": "ul. Bytomska 123",
    "city": "Piekary Śląskie"
  },
  "menu": {
    "items": [
      {
        "id": "item-001",
        "name": "Pizza Margherita",
        "description": "Sos pomidorowy, mozzarella, bazylia",
        "price": 28.00,
        "category": "Pizza",
        "available": true,
        "created_at": "2024-01-20T12:00:00Z"
      },
      {
        "id": "item-002",
        "name": "Pizza Pepperoni",
        "description": "Sos pomidorowy, mozzarella, pepperoni",
        "price": 32.00,
        "category": "Pizza",
        "available": true,
        "created_at": "2024-01-20T12:00:00Z"
      },
      {
        "id": "item-003",
        "name": "Cola 0.5L",
        "description": null,
        "price": 6.00,
        "category": "Napoje",
        "available": true,
        "created_at": "2024-01-20T12:00:00Z"
      }
    ],
    "byCategory": {
      "Pizza": [
        { "id": "item-001", "name": "Pizza Margherita", "price": 28.00, "available": true },
        { "id": "item-002", "name": "Pizza Pepperoni", "price": 32.00, "available": true }
      ],
      "Napoje": [
        { "id": "item-003", "name": "Cola 0.5L", "price": 6.00, "available": true }
      ]
    },
    "totalItems": 3
  }
}
```

---

### 3. GET /conversations

List conversations with stage detection.

**Query Parameters:**
- `limit` (optional, default: 50, max: 100)
- `offset` (optional, default: 0)
- `status` (optional: 'active' | 'closed')

**Example Request:**
```bash
curl -H "x-admin-token: YOUR_TOKEN" http://localhost:3000/api/admin/conversations?limit=20&status=active
```

**Example Response:**
```json
{
  "ok": true,
  "data": [
    {
      "id": "conv-001",
      "sessionId": "sess_1705658400000_abc123",
      "status": "active",
      "stage": 2,
      "stageName": "browsing",
      "createdAt": "2024-06-20T14:00:00Z",
      "updatedAt": "2024-06-20T14:05:00Z"
    },
    {
      "id": "conv-002",
      "sessionId": "sess_1705658300000_def456",
      "status": "closed",
      "stage": 4,
      "stageName": "completed",
      "createdAt": "2024-06-20T13:30:00Z",
      "updatedAt": "2024-06-20T13:45:00Z"
    }
  ],
  "pagination": {
    "total": 156,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

**Stages:**
- 1: `started` - User just began
- 2: `browsing` - User selected restaurant
- 3: `ordering` - User has pending order
- 4: `completed` - Conversation closed

---

### 4. GET /conversations/:sessionId

Get full conversation details with timeline.

**Example Request:**
```bash
curl -H "x-admin-token: YOUR_TOKEN" http://localhost:3000/api/admin/conversations/sess_1705658400000_abc123
```

**Example Response:**
```json
{
  "ok": true,
  "data": {
    "id": "conv-001",
    "sessionId": "sess_1705658400000_abc123",
    "status": "closed",
    "metadata": {
      "lastIntent": "confirm_order",
      "currentRestaurant": { "id": "r-001", "name": "Monte Carlo" }
    },
    "createdAt": "2024-06-20T14:00:00Z",
    "updatedAt": "2024-06-20T14:15:00Z",
    "closedAt": "2024-06-20T14:15:00Z",
    "closedReason": "ORDER_CONFIRMED",
    "timeline": [
      {
        "id": "event-001",
        "type": "user_message",
        "status": "processed",
        "step": "find_nearby",
        "payload": { "text": "Szukam restauracji" },
        "timestamp": "2024-06-20T14:00:00Z"
      },
      {
        "id": "event-002",
        "type": "user_message",
        "status": "processed",
        "step": "menu_request",
        "payload": { "text": "Pokaż menu Monte Carlo" },
        "timestamp": "2024-06-20T14:02:00Z"
      },
      {
        "id": "event-003",
        "type": "user_message",
        "status": "processed",
        "step": "create_order",
        "payload": { "text": "Zamów pizzę margherita" },
        "timestamp": "2024-06-20T14:10:00Z"
      },
      {
        "id": "event-004",
        "type": "user_message",
        "status": "processed",
        "step": "confirm_order",
        "payload": { "text": "Tak, potwierdzam" },
        "timestamp": "2024-06-20T14:15:00Z"
      }
    ]
  }
}
```

---

### 5. GET /orders

List orders with filters.

**Query Parameters:**
- `limit` (optional, default: 50, max: 200)
- `offset` (optional, default: 0)
- `status` (optional: 'pending' | 'accepted' | 'completed' | 'cancelled')
- `restaurant_id` (optional: filter by restaurant UUID)

**Example Request:**
```bash
curl -H "x-admin-token: YOUR_TOKEN" http://localhost:3000/api/admin/orders?status=pending&limit=10
```

**Example Response:**
```json
{
  "ok": true,
  "data": [
    {
      "id": "order-001",
      "restaurantId": "550e8400-e29b-41d4-a716-446655440000",
      "restaurantName": "Pizzeria Monte Carlo",
      "userId": null,
      "items": [
        { "name": "Pizza Margherita", "price": 28, "quantity": 2 },
        { "name": "Cola 0.5L", "price": 6, "quantity": 1 }
      ],
      "totalPrice": 62.00,
      "status": "pending",
      "customer": {
        "name": "Jan Kowalski",
        "phone": "+48 123 456 789",
        "address": "ul. Testowa 1, Piekary Śląskie"
      },
      "notes": "Bez cebuli",
      "createdAt": "2024-06-20T14:15:00Z",
      "updatedAt": "2024-06-20T14:15:00Z"
    }
  ],
  "pagination": {
    "total": 89,
    "limit": 10,
    "offset": 0,
    "hasMore": true
  }
}
```

---

### 6. GET /orders/:id

Get single order with restaurant details.

**Example Request:**
```bash
curl -H "x-admin-token: YOUR_TOKEN" http://localhost:3000/api/admin/orders/order-001
```

**Example Response:**
```json
{
  "ok": true,
  "data": {
    "id": "order-001",
    "restaurantId": "550e8400-e29b-41d4-a716-446655440000",
    "restaurant": {
      "name": "Pizzeria Monte Carlo",
      "address": "ul. Bytomska 123",
      "city": "Piekary Śląskie"
    },
    "userId": null,
    "items": [
      { "name": "Pizza Margherita", "price": 28, "quantity": 2 },
      { "name": "Cola 0.5L", "price": 6, "quantity": 1 }
    ],
    "totalPrice": 62.00,
    "status": "pending",
    "customer": {
      "name": "Jan Kowalski",
      "phone": "+48 123 456 789",
      "address": "ul. Testowa 1, Piekary Śląskie"
    },
    "notes": "Bez cebuli",
    "createdAt": "2024-06-20T14:15:00Z",
    "updatedAt": "2024-06-20T14:15:00Z"
  }
}
```

---

## Error Responses

All errors follow the format:
```json
{
  "ok": false,
  "error": "error_message_here"
}
```

**Common HTTP Status Codes:**
- `400` - Bad Request (missing parameters)
- `403` - Forbidden (invalid/missing admin token)
- `404` - Not Found (resource doesn't exist)
- `500` - Internal Server Error

---

## Usage in Frontend

### Business Panel (React)
```typescript
const fetchOrders = async () => {
  const res = await fetch('/api/admin/orders?status=pending', {
    headers: { 'x-admin-token': ADMIN_TOKEN }
  });
  const { ok, data } = await res.json();
  if (ok) setOrders(data);
};
```

### KDS Panel (Kitchen Display)
```typescript
const fetchPendingOrders = async (restaurantId: string) => {
  const res = await fetch(`/api/admin/orders?restaurant_id=${restaurantId}&status=pending`, {
    headers: { 'x-admin-token': ADMIN_TOKEN }
  });
  return res.json();
};
```
