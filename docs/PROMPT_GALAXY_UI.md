# 🌌 PROMPT: Galaxy UI Glassmorph Admin Panel - Gemini 3.0 Pro

## KONTEKST PROJEKTU

FreeFlow to platforma zamówień jedzenia z AI asystentem "Amber". Panel administracyjny (`AdminPanel.jsx`) zawiera:
- **KPI Cards**: Przychód, zamówienia, średnia wartość, zadowolenie klientów
- **Wykresy**: Chart.js (Line, Doughnut, Bar) - trendy zamówień, rozkład godzinowy, intencje Amber
- **Amber Diagnostics**: Metryki NLU/DB/TTS, live monitoring, performance trends
- **Business Stats**: Przychód, konwersja, interakcje
- **Top Lists**: Najpopularniejsze dania i restauracje
- **Accounts Management**: Zarządzanie kontami użytkowników
- **Alerts System**: System powiadomień i alertów
- **Tabs**: Insights, Control Deck, Learning, UI Config

## WYMAGANIA STYLU: GALAXY UI GLASSMORPH

### 1. GLASSMORPHISM
- **Tła**: `backdrop-filter: blur(20px)`, `background: rgba(15, 23, 42, 0.3)`
- **Bordery**: Subtelne, świecące `border: 1px solid rgba(139, 92, 246, 0.3)`
- **Cienie**: `box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), inset 0 0 20px rgba(139, 92, 246, 0.1)`
- **Przezroczystość**: Warstwowe, głębokie tła z różnymi poziomami opacity

### 2. GALAXY COLOR PALETTE
```css
/* Deep Space Background */
--space-black: #0a0a0f;
--space-dark: #1a1a2e;
--space-deep: #16213e;

/* Neon Accents */
--neon-cyan: #00f5ff;
--neon-purple: #8b5cf6;
--neon-pink: #ec4899;
--neon-blue: #3b82f6;

/* Galaxy Gradients */
--galaxy-gradient-1: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
--galaxy-gradient-2: radial-gradient(circle at 20% 50%, rgba(139, 92, 246, 0.3), transparent 50%);
--galaxy-gradient-3: linear-gradient(180deg, rgba(6, 182, 212, 0.1) 0%, transparent 100%);
```

### 3. EFEKTY ŚWIETLNE (GLOW)
- **Neon Glow**: `text-shadow: 0 0 10px currentColor, 0 0 20px currentColor, 0 0 30px currentColor`
- **Box Glow**: `box-shadow: 0 0 20px rgba(139, 92, 246, 0.5), 0 0 40px rgba(139, 92, 246, 0.3)`
- **Hover Glow**: Intensywniejszy glow przy hover
- **Pulse Animation**: Subtelne pulsowanie dla ważnych elementów

### 4. ANIMACJE KOSMICZNE
- **Stars Background**: Animowane gwiazdy w tle (CSS keyframes)
- **Particle Effects**: Subtelne cząsteczki unoszące się
- **Holographic Shimmer**: Efekt holograficznego połysku na kartach
- **Smooth Transitions**: Wszystkie interakcje z płynnymi przejściami (0.3s ease)

### 5. TYPOGRAPHY
- **Font**: 'Inter', 'SF Pro Display', lub podobny nowoczesny sans-serif
- **Headings**: Bold, z neon glow na ważnych elementach
- **Numbers**: Extra bold, duże, z efektem świecenia
- **Labels**: Subtelne, półprzezroczyste

## STRUKTURA KOMPONENTÓW DO PRZEBUDOWY

### 1. KPI CARDS (4 karty)
**Obecny styl**: Szare tła, proste bordery
**Nowy styl**:
- Glassmorphic card z blur effect
- Neon border glow (cyan/purple gradient)
- Holographic shimmer animation
- Pulsujący glow na wartości
- Gradient progress bar na górze karty
- 3D hover effect (subtle lift)

### 2. WYKRESY (Chart.js)
**Obecny styl**: Standardowe kolory
**New style**:
- Neon line colors (cyan, purple, pink)
- Glowing data points
- Glassmorphic chart container
- Animated gradient fills
- Holographic grid lines
- Interactive glow on hover

### 3. AMBER DIAGNOSTICS
**Obecny styl**: Proste paski
**Nowy styl**:
- Neon progress bars z glow
- Particle effects przy zmianach wartości
- Holographic status indicators
- Real-time pulse animation
- Galaxy-themed color coding

### 4. BUSINESS STATS
**Obecny styl**: Proste karty
**Nowy styl**:
- Glassmorphic stat cards
- Animated number counters
- Gradient backgrounds per metric
- Holographic icons
- Pulse on value changes

### 5. TOP LISTS (Dishes/Restaurants)
**Obecny styl**: Lista z numerami
**Nowy styl**:
- Glassmorphic list items
- Neon rank badges (holographic)
- Hover glow effects
- Animated entry (stagger)
- Gradient separators

### 6. TABS NAVIGATION
**Obecny styl**: Proste przyciski
**Nowy styl**:
- Glassmorphic tab container
- Neon active indicator
- Smooth slide animation
- Glow on active tab
- Holographic tab icons

### 7. ALERTS SYSTEM
**Obecny styl**: Prosta tabela
**Nowy styl**:
- Glassmorphic alert cards
- Color-coded neon borders (red/yellow/green)
- Pulse animation dla ważnych alertów
- Holographic severity indicators
- Smooth slide-in animations

## TECHNICZNE WYMAGANIA

### CSS Features
- `backdrop-filter: blur()` dla glassmorphism
- `clip-path` dla futurystycznych kształtów
- `filter: drop-shadow()` dla neon glow
- CSS Grid/Flexbox dla responsywności
- CSS Variables dla łatwej zmiany kolorów
- Keyframe animations dla efektów kosmicznych

### React/Framer Motion
- `framer-motion` dla płynnych animacji
- Stagger animations dla list
- Page transitions
- Hover state animations
- Loading skeleton z glassmorphic style

### Performance
- CSS animations zamiast JS gdzie możliwe
- `will-change` dla optymalizacji
- Lazy loading dla ciężkich komponentów
- Debounced hover effects

## SZCZEGÓŁOWE SPECYFIKACJE WIZUALNE

### Background
```css
background: 
  radial-gradient(circle at 20% 50%, rgba(139, 92, 246, 0.15), transparent 50%),
  radial-gradient(circle at 80% 80%, rgba(6, 182, 212, 0.1), transparent 50%),
  linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #16213e 100%);
```

### Card Template
```css
.galaxy-card {
  background: rgba(15, 23, 42, 0.3);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(139, 92, 246, 0.3);
  border-radius: 24px;
  box-shadow: 
    0 8px 32px rgba(0, 0, 0, 0.4),
    inset 0 0 20px rgba(139, 92, 246, 0.1),
    0 0 40px rgba(139, 92, 246, 0.2);
  position: relative;
  overflow: hidden;
}

.galaxy-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(139, 92, 246, 0.2),
    transparent
  );
  animation: shimmer 3s infinite;
}
```

### Neon Text
```css
.neon-text {
  color: #00f5ff;
  text-shadow: 
    0 0 5px #00f5ff,
    0 0 10px #00f5ff,
    0 0 15px #00f5ff,
    0 0 20px #00f5ff;
}
```

### Animated Stars Background
```css
@keyframes twinkle {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

.star {
  position: absolute;
  width: 2px;
  height: 2px;
  background: white;
  border-radius: 50%;
  animation: twinkle 2s infinite;
  box-shadow: 0 0 6px white;
}
```

## PROMPT DLA GEMINI 3.0 PRO

```
Stwórz futurystyczny admin panel w stylu "Galaxy UI Glassmorph" dla aplikacji FreeFlow (platforma zamówień jedzenia z AI asystentem Amber).

KONTEKST:
- React komponent AdminPanel.jsx z Chart.js wykresami
- Obecny styl: ciemne tła, proste karty, standardowe kolory
- Funkcjonalności: KPI cards, wykresy, diagnostics, stats, top lists, alerts

WYMAGANIA WIZUALNE:

1. GLASSMORPHISM:
   - Wszystkie karty: backdrop-filter: blur(20px), rgba(15,23,42,0.3) tła
   - Subtelne, świecące bordery: rgba(139,92,246,0.3)
   - Warstwowe cienie z neon glow
   - Holographic shimmer animation na kartach

2. GALAXY COLOR PALETTE:
   - Deep space background: #0a0a0f → #1a1a2e → #16213e gradient
   - Neon accents: cyan (#00f5ff), purple (#8b5cf6), pink (#ec4899)
   - Radial gradients dla głębi kosmicznej
   - Animated stars w tle (CSS keyframes)

3. NEON GLOW EFFECTS:
   - Wszystkie ważne liczby: text-shadow z neon glow
   - Karty: box-shadow z kolorowym glow (purple/cyan)
   - Hover states: intensywniejszy glow
   - Pulsujące animacje dla KPI values

4. KOMPONENTY DO PRZEBUDOWY:

   a) KPI CARDS (4 karty):
      - Glassmorphic z blur
      - Neon border glow (gradient cyan→purple)
      - Holographic shimmer overlay
      - Pulsujący glow na wartości
      - Gradient progress bar na górze
      - 3D hover lift effect

   b) WYKRESY (Chart.js Line/Doughnut/Bar):
      - Neon line colors (cyan, purple, pink)
      - Glowing data points
      - Glassmorphic container
      - Animated gradient fills
      - Holographic grid lines
      - Interactive glow on hover

   c) AMBER DIAGNOSTICS:
      - Neon progress bars z glow
      - Particle effects przy zmianach
      - Holographic status indicators
      - Real-time pulse animation
      - Galaxy color coding

   d) BUSINESS STATS:
      - Glassmorphic stat cards
      - Animated number counters
      - Gradient backgrounds per metric
      - Holographic icons
      - Pulse on value changes

   e) TOP LISTS:
      - Glassmorphic list items
      - Neon rank badges (holographic)
      - Hover glow effects
      - Staggered entry animations
      - Gradient separators

   f) TABS:
      - Glassmorphic container
      - Neon active indicator
      - Smooth slide animation
      - Glow on active tab
      - Holographic icons

   g) ALERTS:
      - Glassmorphic cards
      - Color-coded neon borders
      - Pulse dla ważnych alertów
      - Holographic severity indicators
      - Slide-in animations

5. ANIMACJE:
   - Stars background (twinkling)
   - Particle effects (subtle)
   - Holographic shimmer (3s loop)
   - Smooth transitions (0.3s ease)
   - Stagger animations dla list
   - Pulse dla ważnych wartości

6. TYPOGRAPHY:
   - Font: 'Inter' lub 'SF Pro Display'
   - Headings: Bold z neon glow
   - Numbers: Extra bold, duże, glowing
   - Labels: Subtelne, półprzezroczyste

7. RESPONSYWNOŚĆ:
   - Mobile-first approach
   - Adaptive glassmorphism (mniejszy blur na mobile)
   - Touch-friendly hover states
   - Collapsible sections

TECHNICZNE:
- Użyj CSS Variables dla łatwej zmiany kolorów
- backdrop-filter dla glassmorphism
- CSS animations zamiast JS gdzie możliwe
- Framer Motion dla React animations
- Performance: will-change, lazy loading

DOSTARCZ:
1. Pełny kod React komponentu z wszystkimi stylami
2. CSS/SCSS z animacjami i keyframes
3. Konfigurację Chart.js z neon colors
4. Framer Motion animations
5. Responsive breakpoints
6. Komentarze w kodzie wyjaśniające efekty

STYL KOŃCOWY:
Panel powinien wyglądać jak futurystyczny dashboard z filmu sci-fi - głęboka przestrzeń kosmiczna, świecące neony, holograficzne efekty, wszystko w stylu glassmorphism. Użytkownik powinien czuć się jak pilot statku kosmicznego przeglądający dane w zaawansowanym systemie nawigacyjnym.
```

## DODATKOWE INSPIRACJE

### Reference Designs
- Tron Legacy UI
- Blade Runner 2049 interfaces
- Star Wars holographic displays
- Cyberpunk 2077 UI elements
- No Man's Sky interface

### Key Visual Elements
- Deep space gradients
- Neon wireframes
- Holographic projections
- Particle systems
- Glitch effects (subtle)
- Scan lines (optional)

---

**UWAGA**: Prompt jest gotowy do użycia w LLMarena z Gemini 3.0 Pro. Zawiera wszystkie szczegóły techniczne i wizualne potrzebne do wygenerowania kompletnego, futurystycznego admin panelu w stylu Galaxy UI Glassmorph.


