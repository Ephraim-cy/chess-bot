import { useState, useEffect, useRef } from 'react'
import { Chess } from 'chess.js'

const API = 'https://chess-bot-production-efa2.up.railway.app'
const WSS = 'wss://chess-bot-production-efa2.up.railway.app'
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
// ─── CURRENCY CONFIG ──────────────────────────────────────────────────────────
// Stakes, symbols, and decimals per currency.
// All financial validation happens SERVER-SIDE — this is display config only.
const CURRENCY_CONFIG = {
  USDT: {
    symbol: '$',
    unit: 'USDT',
    icon: '💵',
    stakes: [1, 5, 10, 25, 50],
    decimals: 2,
    color: '#26A17B',        // Tether green
    description: 'Tether USD — stable, pegged 1:1 to US Dollar'
  },
  TON: {
    symbol: '◎',
    unit: 'TON',
    icon: '💎',
    stakes: [0.5, 1, 2, 5, 10],
    decimals: 2,
    color: '#0088CC',        // TON blue
    description: 'The Open Network — Telegram\'s native blockchain'
  },
  STARS: {
    symbol: '★',
    unit: 'Stars',
    icon: '⭐',
    stakes: [50, 100, 250, 500, 1000],
    decimals: 0,
    color: '#F59E0B',        // Gold
    description: 'Telegram Stars — buy directly inside Telegram'
  }
}

const tg = window.Telegram?.WebApp
const tgUser = tg?.initDataUnsafe?.user || { id: 0, username: 'Player' }

// ─── PIECE UNICODE ────────────────────────────────────────────────────────────
const PIECES = {
  wK:'♔', wQ:'♕', wR:'♖', wB:'♗', wN:'♘', wP:'♙',
  bK:'♚', bQ:'♛', bR:'♜', bB:'♝', bN:'♞', bP:'♟'
}

// ─── LOCAL CHESS ENGINE (minimax — instant, no API) ──────────────────────────
const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 }

const PST = {
  p: [ 0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0 ],
  n: [ -50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50 ],
  b: [ -20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20 ],
  r: [ 0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0 ],
  q: [ -20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20 ],
  k: [ -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20 ]
}

function evaluateBoard(chess) {
  if (chess.isCheckmate()) return chess.turn() === 'w' ? -99999 : 99999
  if (chess.isDraw()) return 0
  let score = 0
  chess.board().forEach((row, ri) => {
    row.forEach((piece, fi) => {
      if (!piece) return
      const pstIdx = piece.color === 'w' ? (7 - ri) * 8 + fi : ri * 8 + fi
      const val = PIECE_VALUE[piece.type] + (PST[piece.type]?.[pstIdx] || 0)
      score += piece.color === 'w' ? val : -val
    })
  })
  return score
}

function minimax(chess, depth, alpha, beta, maximizing) {
  if (depth === 0 || chess.isGameOver()) return evaluateBoard(chess)
  const moves = chess.moves()
  if (maximizing) {
    let best = -Infinity
    for (const move of moves) {
      chess.move(move); best = Math.max(best, minimax(chess, depth-1, alpha, beta, false)); chess.undo()
      alpha = Math.max(alpha, best); if (beta <= alpha) break
    }
    return best
  } else {
    let best = Infinity
    for (const move of moves) {
      chess.move(move); best = Math.min(best, minimax(chess, depth-1, alpha, beta, true)); chess.undo()
      beta = Math.min(beta, best); if (beta <= alpha) break
    }
    return best
  }
}

function fetchAIMove(fen, difficulty) {
  return new Promise(resolve => {
    setTimeout(() => {
      const chess = new Chess(fen)
      const moves = chess.moves({ verbose: true })
      if (!moves.length) return resolve(null)
      if (difficulty === 'easy') {
        const m = moves[Math.floor(Math.random() * moves.length)]
        return resolve(m.from + m.to + (m.promotion || ''))
      }
      const depth = difficulty === 'hard' ? 3 : 2
      const isMax = chess.turn() === 'w'
      let bestScore = isMax ? -Infinity : Infinity, bestMove = moves[0]
      for (let i = moves.length-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [moves[i],moves[j]]=[moves[j],moves[i]] }
      for (const move of moves) {
        chess.move(move)
        const score = minimax(chess, depth-1, -Infinity, Infinity, !isMax)
        chess.undo()
        if (isMax ? score > bestScore : score < bestScore) { bestScore = score; bestMove = move }
      }
      resolve(bestMove.from + bestMove.to + (bestMove.promotion || ''))
    }, 100)
  })
}

// ─── SOUND ENGINE (Web Audio API — no libraries needed) ──────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext

function createSoundEngine() {
  let ctx = null

  function getCtx() {
    if (!ctx) ctx = new AudioCtx()
    // Resume if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  }

  function playTone({ type = 'sine', freq, freq2, duration, volume = 0.4, attack = 0.01, decay = 0.1, fadeStart, notes }) {
    const c = getCtx()
    const now = c.currentTime

    // If notes array given, play each note sequentially
    if (notes) {
      notes.forEach(n => playTone(n))
      return
    }

    const osc  = c.createOscillator()
    const gain = c.createGain()
    osc.connect(gain)
    gain.connect(c.destination)

    osc.type = type
    osc.frequency.setValueAtTime(freq, now)
    if (freq2) osc.frequency.exponentialRampToValueAtTime(freq2, now + duration * 0.5)

    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(volume, now + attack)
    if (fadeStart != null) {
      gain.gain.setValueAtTime(volume, now + fadeStart)
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration)
    } else {
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration)
    }

    osc.start(now)
    osc.stop(now + duration)
  }

  return {
    // Soft woody thud — piece placed on board
    move() {
      playTone({ type: 'triangle', freq: 180, freq2: 90, duration: 0.18, volume: 0.5, attack: 0.005 })
    },

    // Harder crack — piece taken
    capture() {
      playTone({ type: 'sawtooth', freq: 260, freq2: 80, duration: 0.22, volume: 0.45, attack: 0.005 })
      setTimeout(() => playTone({ type: 'triangle', freq: 120, duration: 0.15, volume: 0.3 }), 60)
    },

    // Tense two-tone pulse — king is in check
    check() {
      playTone({ notes: [
        { type: 'square', freq: 440, duration: 0.12, volume: 0.3, attack: 0.01 },
        { type: 'square', freq: 554, duration: 0.12, volume: 0.3, attack: 0.01, fadeStart: 0.08 }
      ]})
      setTimeout(() => playTone({ type: 'square', freq: 554, duration: 0.14, volume: 0.3 }), 160)
    },

    // Castling — double knock
    castle() {
      playTone({ type: 'triangle', freq: 200, freq2: 110, duration: 0.16, volume: 0.45, attack: 0.005 })
      setTimeout(() => playTone({ type: 'triangle', freq: 160, freq2: 90, duration: 0.16, volume: 0.35, attack: 0.005 }), 120)
    },

    // Rising arpeggio — game start
    gameStart() {
      const notes = [261, 329, 392, 523]
      notes.forEach((f, i) => {
        setTimeout(() => playTone({ type: 'sine', freq: f, duration: 0.25, volume: 0.3, attack: 0.02 }), i * 120)
      })
    },

    // Triumphant fanfare — you win
    win() {
      const seq = [
        { freq: 392, dur: 120 }, { freq: 392, dur: 120 }, { freq: 392, dur: 120 },
        { freq: 523, dur: 400 }, { freq: 440, dur: 200 }, { freq: 523, dur: 500 }
      ]
      let t = 0
      seq.forEach(({ freq, dur }) => {
        setTimeout(() => playTone({ type: 'sine', freq, duration: dur / 1000 + 0.05, volume: 0.35, attack: 0.02 }), t)
        t += dur + 20
      })
    },

    // Descending sad tones — you lose
    lose() {
      const seq = [{ freq: 330, dur: 200 }, { freq: 277, dur: 200 }, { freq: 220, dur: 400 }]
      let t = 0
      seq.forEach(({ freq, dur }) => {
        setTimeout(() => playTone({ type: 'sine', freq, duration: dur / 1000 + 0.05, volume: 0.28, attack: 0.02 }), t)
        t += dur + 20
      })
    },

    // Neutral chord — draw
    draw() {
      playTone({ type: 'sine', freq: 330, duration: 0.5, volume: 0.25, attack: 0.04 })
      playTone({ type: 'sine', freq: 392, duration: 0.5, volume: 0.2,  attack: 0.04 })
    },

    // Soft click — UI button press
    click() {
      playTone({ type: 'sine', freq: 600, freq2: 400, duration: 0.08, volume: 0.2, attack: 0.005 })
    }
  }
}

// Single instance — created lazily on first user interaction
let _sfx = null
function sfx() {
  if (!_sfx) _sfx = createSoundEngine()
  return _sfx
}

// Helper — call after chess.move() to auto-pick the right sound
function playSoundForMove(move, chess) {
  if (!move) return
  if (chess.isCheckmate())      { sfx().win(); return }   // handled by game-over logic separately
  if (chess.isCheck())          { sfx().check(); return }
  if (move.flags.includes('k') || move.flags.includes('q')) { sfx().castle(); return }
  if (move.captured)            { sfx().capture(); return }
  sfx().move()
}
// ─── CUSTOM CHESS BOARD ───────────────────────────────────────────────────────
function ChessBoard({ chess, orientation, selectedSq, legalTargets, onSquareTap, showHints, lastMove, checkedKingSq }) {
  const files = ['a','b','c','d','e','f','g','h']
  const ranks = ['8','7','6','5','4','3','2','1']

  // flip for black orientation
  const displayFiles = orientation === 'black' ? [...files].reverse() : files
  const displayRanks = orientation === 'black' ? [...ranks].reverse() : ranks

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(8, 1fr)',
      width: '100%',
      aspectRatio: '1 / 1',
      borderRadius: 6,
      overflow: 'hidden',
      boxShadow: '0 8px 32px rgba(0,0,0,.7)',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      touchAction: 'manipulation'
    }}>
      {displayRanks.map(rank =>
        displayFiles.map(file => {
          const sq = file + rank
          const fileIdx = files.indexOf(file)
          const rankIdx = ranks.indexOf(rank)
          const isLight = (fileIdx + rankIdx) % 2 === 0
          const piece = chess.get(sq)
          const pieceKey = piece ? piece.color + piece.type.toUpperCase() : null
          const isSelected = sq === selectedSq
          const isLegal = legalTargets.includes(sq)
          const isLastFrom = lastMove && lastMove.from === sq
          const isLastTo   = lastMove && lastMove.to === sq
          const hasPiece = !!piece

          // Square background
          const isCheckedKing = sq === checkedKingSq
          let bg = isLight ? '#FCD34D' : '#B45309'
          if (isSelected)           bg = '#6366F1'
          else if (isCheckedKing)   bg = '#EF4444'                          // red — king in check
          else if (isLastFrom || isLastTo) bg = isLight ? '#a3e635' : '#65a30d'

          return (
            <div
              key={sq}
              onPointerDown={(e) => {
                e.preventDefault()
                onSquareTap(sq)
              }}
              style={{
                position: 'relative',
                background: bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {/* Legal move indicator */}
              {isLegal && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'none',
                  zIndex: 2
                }}>
                  {hasPiece ? (
                    // Capture ring
                    <div style={{
                      width: '90%', height: '90%',
                      borderRadius: '50%',
                      border: showHints ? '4px solid rgba(16,185,129,0.85)' : '3px solid rgba(255,255,255,0.4)',
                      boxSizing: 'border-box'
                    }} />
                  ) : (
                    // Move dot
                    <div style={{
                      width: showHints ? '44%' : '30%',
                      height: showHints ? '44%' : '30%',
                      borderRadius: '50%',
                      background: showHints ? 'rgba(16,185,129,0.8)' : 'rgba(255,255,255,0.35)'
                    }} />
                  )}
                </div>
              )}

              {/* Piece */}
              {pieceKey && (
                <span style={{
                  fontSize: 'clamp(20px, 6vw, 42px)',
                  lineHeight: 1,
                  zIndex: 3,
                  filter: isSelected ? 'brightness(1.4) drop-shadow(0 0 6px rgba(255,255,255,0.8))' : 'drop-shadow(1px 1px 1px rgba(0,0,0,0.5))',
                  transition: 'filter 0.1s'
                }}>
                  {PIECES[pieceKey]}
                </span>
              )}

              {/* Rank/File labels on edge squares */}
              {file === displayFiles[0] && (
                <span style={{ position: 'absolute', top: 2, left: 3, fontSize: 9, fontWeight: 700, color: isLight ? '#B45309' : '#FCD34D', opacity: 0.7, lineHeight: 1 }}>
                  {rank}
                </span>
              )}
              {rank === displayRanks[7] && (
                <span style={{ position: 'absolute', bottom: 2, right: 3, fontSize: 9, fontWeight: 700, color: isLight ? '#B45309' : '#FCD34D', opacity: 0.7, lineHeight: 1 }}>
                  {file}
                </span>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

// ─── PROFILE SCREEN ───────────────────────────────────────────────────────────
function ProfileScreen({ onBack }) {
  const [profile, setProfile]   = useState(null)
  const [txns, setTxns]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState('overview')   // 'overview' | 'history'
  const [error, setError]       = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [meRes, txRes] = await Promise.all([
          fetch(API + '/api/me',           { headers: { 'x-init-data': 'test' } }),
          fetch(API + '/api/transactions', { headers: { 'x-init-data': 'test' } })
        ])
        if (meRes.ok)  setProfile(await meRes.json())
        if (txRes.ok)  setTxns((await txRes.json()).transactions || [])
      } catch { setError('Could not load profile. Check connection.') }
      setLoading(false)
    }
    load()
  }, [])

  const avatarLetter = (tgUser.username || tgUser.first_name || 'P')[0].toUpperCase()
  const playable  = parseFloat(profile?.playable_balance  || 0)
  const locked    = parseFloat(profile?.locked_balance    || 0)
  const total     = playable + locked

  // Derive win/loss/draw counts from transaction history
  const wins   = txns.filter(t => t.type === 'winnings').length
  const losses = txns.filter(t => t.type === 'rake' || t.type === 'loss').length
  const totalGames = wins + losses

  // Type → display config
  function txMeta(type) {
    if (type === 'deposit')  return { label: 'Deposit',   color: '#10B981', sign: '+', icon: '⬇️' }
    if (type === 'withdraw') return { label: 'Withdraw',  color: '#EF4444', sign: '-', icon: '⬆️' }
    if (type === 'winnings') return { label: 'Winnings',  color: '#10B981', sign: '+', icon: '🏆' }
    if (type === 'stake')    return { label: 'Stake',     color: '#F59E0B', sign: '-', icon: '🎯' }
    if (type === 'refund')   return { label: 'Refund',    color: '#6366F1', sign: '+', icon: '↩️' }
    if (type === 'rake')     return { label: 'Fee',       color: '#6B7280', sign: '-', icon: '💸' }
    return                          { label: type,        color: '#9CA3AF', sign: '',  icon: '•'  }
  }

  function formatDate(iso) {
    if (!iso) return '—'
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
      + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }

  const tabStyle = (active) => ({
    flex: 1, padding: '9px 4px', borderRadius: 8, border: 'none',
    background: active ? 'rgba(99,102,241,.2)' : 'transparent',
    color: active ? '#A5B4FC' : '#4B5563',
    fontWeight: 700, fontSize: '.82rem', cursor: 'pointer',
    borderBottom: active ? '2px solid #6366F1' : '2px solid transparent',
    WebkitTapHighlightColor: 'transparent', transition: 'all .15s'
  })

  return (
    <div style={{ minHeight: '100vh', background: '#080B14', color: '#eaeaea', fontFamily: 'sans-serif', paddingBottom: 32 }}>

      {/* ── Top header bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
        <button onPointerDown={onBack} style={{ background: 'transparent', border: 'none', color: '#6B7280', fontSize: '1.1rem', cursor: 'pointer', padding: '4px 8px', WebkitTapHighlightColor: 'transparent' }}>←</button>
        <div style={{ fontWeight: 800, color: '#818CF8', fontSize: '1rem' }}>My Account</div>
      </div>

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '60px 20px', color: '#4B5563' }}>
          <div style={{ fontSize: 32, animation: 'spin 1s linear infinite' }}>⟳</div>
          <div style={{ fontSize: '.85rem' }}>Loading your profile...</div>
        </div>
      )}

      {error && (
        <div style={{ margin: '20px 16px', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 10, padding: '12px 16px', color: '#FCA5A5', fontSize: '.85rem', textAlign: 'center' }}>
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* ── Avatar + identity card ── */}
          <div style={{ margin: '20px 16px 0', background: 'linear-gradient(135deg,#111827,#1a2236)', border: '1px solid rgba(99,102,241,.2)', borderRadius: 16, padding: '20px 20px 16px', position: 'relative', overflow: 'hidden' }}>
            {/* Glow blob */}
            <div style={{ position: 'absolute', top: -30, right: -30, width: 120, height: 120, background: 'rgba(99,102,241,.12)', borderRadius: '50%', filter: 'blur(30px)', pointerEvents: 'none' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {/* Avatar circle */}
              <div style={{ width: 58, height: 58, borderRadius: '50%', background: 'linear-gradient(135deg,#6366F1,#8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 900, color: '#fff', flexShrink: 0, boxShadow: '0 0 0 3px rgba(99,102,241,.3)' }}>
                {avatarLetter}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#eaeaea', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  @{tgUser.username || tgUser.first_name || 'Player'}
                </div>
                <div style={{ color: '#4B5563', fontSize: '.75rem', marginTop: 2 }}>
                  Telegram ID: <span style={{ color: '#6366F1', fontFamily: 'monospace' }}>{tgUser.id || '—'}</span>
                </div>
                <div style={{ display: 'inline-block', marginTop: 6, background: profile?.status === 'active' ? 'rgba(16,185,129,.15)' : 'rgba(239,68,68,.15)', border: `1px solid ${profile?.status === 'active' ? 'rgba(16,185,129,.4)' : 'rgba(239,68,68,.4)'}`, borderRadius: 20, padding: '2px 10px', fontSize: '.68rem', fontWeight: 700, color: profile?.status === 'active' ? '#10B981' : '#EF4444', letterSpacing: '.5px' }}>
                  {(profile?.status || 'active').toUpperCase()}
                </div>
              </div>
            </div>

            {/* Total balance hero */}
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,.05)' }}>
              <div style={{ color: '#4B5563', fontSize: '.7rem', fontWeight: 700, letterSpacing: '1px', marginBottom: 4 }}>TOTAL BALANCE</div>
              <div style={{ fontSize: '2rem', fontWeight: 900, color: '#A5B4FC', letterSpacing: '-1px' }}>
                ${total.toFixed(2)} <span style={{ fontSize: '.9rem', color: '#6366F1', fontWeight: 700 }}>USDT</span>
              </div>
            </div>
          </div>

          {/* ── Balance breakdown cards ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '10px 16px 0' }}>
            <div style={{ background: '#111827', border: '1px solid rgba(16,185,129,.2)', borderRadius: 12, padding: '14px' }}>
              <div style={{ color: '#4B5563', fontSize: '.68rem', fontWeight: 700, letterSpacing: '.8px', marginBottom: 6 }}>AVAILABLE</div>
              <div style={{ color: '#10B981', fontSize: '1.2rem', fontWeight: 800 }}>${playable.toFixed(2)}</div>
              <div style={{ color: '#374151', fontSize: '.68rem', marginTop: 3 }}>Ready to play</div>
            </div>
            <div style={{ background: '#111827', border: '1px solid rgba(245,158,11,.2)', borderRadius: 12, padding: '14px' }}>
              <div style={{ color: '#4B5563', fontSize: '.68rem', fontWeight: 700, letterSpacing: '.8px', marginBottom: 6 }}>IN ESCROW</div>
              <div style={{ color: '#F59E0B', fontSize: '1.2rem', fontWeight: 800 }}>${locked.toFixed(2)}</div>
              <div style={{ color: '#374151', fontSize: '.68rem', marginTop: 3 }}>Active match</div>
            </div>
          </div>

          {/* ── Stats row ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, margin: '10px 16px 0' }}>
            {[
              { label: 'GAMES',  value: totalGames, color: '#A5B4FC' },
              { label: 'WINS',   value: wins,        color: '#10B981' },
              { label: 'LOSSES', value: losses,      color: '#EF4444' },
            ].map(s => (
              <div key={s.label} style={{ background: '#111827', border: '1px solid rgba(255,255,255,.06)', borderRadius: 12, padding: '12px 10px', textAlign: 'center' }}>
                <div style={{ color: s.color, fontSize: '1.3rem', fontWeight: 900 }}>{s.value}</div>
                <div style={{ color: '#4B5563', fontSize: '.62rem', fontWeight: 700, letterSpacing: '.8px', marginTop: 3 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* ── Deposit / Withdraw action buttons ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '14px 16px 0' }}>
            <button onPointerDown={() => alert('Deposit flow coming soon.\nSend USDT to your wallet address and contact support.')}
              style={{ background: 'linear-gradient(135deg,#10B981,#059669)', border: 'none', borderRadius: 12, padding: '13px', color: '#fff', fontWeight: 800, fontSize: '.9rem', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
              ⬇️ Deposit
            </button>
            <button onPointerDown={() => alert('Withdraw flow coming soon.\nMinimum withdrawal: $5 USDT.')}
              style={{ background: playable >= 5 ? 'linear-gradient(135deg,#6366F1,#8B5CF6)' : '#1f2937', border: 'none', borderRadius: 12, padding: '13px', color: playable >= 5 ? '#fff' : '#4B5563', fontWeight: 800, fontSize: '.9rem', cursor: playable >= 5 ? 'pointer' : 'not-allowed', WebkitTapHighlightColor: 'transparent' }}>
              ⬆️ Withdraw
            </button>
          </div>
          <div style={{ margin: '6px 16px 0', color: '#374151', fontSize: '.7rem', textAlign: 'center' }}>
            Minimum withdrawal: $5.00 USDT · 10% platform fee on winnings
          </div>

          {/* ── Tab switcher ── */}
          <div style={{ display: 'flex', gap: 4, margin: '18px 16px 0', background: '#0d1117', borderRadius: 10, padding: 4 }}>
            <button onPointerDown={() => setTab('overview')} style={tabStyle(tab === 'overview')}>📊 Overview</button>
            <button onPointerDown={() => setTab('history')}  style={tabStyle(tab === 'history')}>📋 History ({txns.length})</button>
          </div>

          {/* ── Overview tab ── */}
          {tab === 'overview' && (
            <div style={{ margin: '12px 16px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Win rate bar */}
              <div style={{ background: '#111827', border: '1px solid rgba(255,255,255,.06)', borderRadius: 12, padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: '#6B7280', fontSize: '.75rem', fontWeight: 700 }}>WIN RATE</span>
                  <span style={{ color: '#A5B4FC', fontSize: '.75rem', fontWeight: 800 }}>
                    {totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0}%
                  </span>
                </div>
                <div style={{ height: 8, background: '#1f2937', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${totalGames > 0 ? (wins / totalGames) * 100 : 0}%`, background: 'linear-gradient(90deg,#10B981,#34D399)', borderRadius: 99, transition: 'width .6s ease' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                  <span style={{ color: '#10B981', fontSize: '.68rem' }}>{wins} wins</span>
                  <span style={{ color: '#EF4444', fontSize: '.68rem' }}>{losses} losses</span>
                </div>
              </div>

              {/* Account info rows */}
              {[
                { label: 'Account ID',   value: profile?.id ? profile.id.slice(0,8) + '...' : '—', mono: true },
                { label: 'Telegram ID',  value: tgUser.id || '—', mono: true },
                { label: 'Username',     value: '@' + (tgUser.username || tgUser.first_name || 'Player'), mono: false },
                { label: 'Status',       value: (profile?.status || 'active').toUpperCase(), mono: false },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#111827', border: '1px solid rgba(255,255,255,.06)', borderRadius: 10, padding: '12px 14px' }}>
                  <span style={{ color: '#6B7280', fontSize: '.8rem' }}>{row.label}</span>
                  <span style={{ color: '#A5B4FC', fontSize: '.8rem', fontWeight: 700, fontFamily: row.mono ? 'monospace' : 'inherit' }}>{row.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── History tab ── */}
          {tab === 'history' && (
            <div style={{ margin: '12px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {txns.length === 0 && (
                <div style={{ textAlign: 'center', color: '#4B5563', padding: '40px 0', fontSize: '.85rem' }}>
                  No transactions yet.<br />Play a match to see your history here.
                </div>
              )}
              {txns.map((t, i) => {
                const m = txMeta(t.type)
                return (
                  <div key={t.id || i} style={{ background: '#111827', border: '1px solid rgba(255,255,255,.06)', borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    {/* Icon */}
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: `${m.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0 }}>
                      {m.icon}
                    </div>
                    {/* Label + date */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '.82rem', color: '#eaeaea' }}>{m.label}</div>
                      <div style={{ color: '#4B5563', fontSize: '.68rem', marginTop: 1 }}>{formatDate(t.created_at)}</div>
                    </div>
                    {/* Amount */}
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: '.9rem', color: m.color }}>
                        {m.sign}${parseFloat(t.amount || 0).toFixed(2)}
                      </div>
                      <div style={{ fontSize: '.65rem', color: t.status === 'completed' ? '#10B981' : '#F59E0B', marginTop: 1, fontWeight: 700 }}>
                        {(t.status || 'pending').toUpperCase()}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const S = {
  page: {
    minHeight: '100vh', background: '#080B14', color: '#eaeaea',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '16px 10px 28px', gap: '12px', fontFamily: 'sans-serif'
  },
  box: {
    background: '#111827', border: '1px solid rgba(255,255,255,.08)',
    borderRadius: '12px', padding: '16px', width: '100%', maxWidth: '440px',
    boxSizing: 'border-box'
  },
  btn: (bg, dis) => ({
    background: dis ? '#1f2937' : bg, color: dis ? '#4b5563' : '#fff',
    border: 'none', padding: '13px', borderRadius: '10px',
    fontWeight: '700', fontSize: '1rem',
    cursor: dis ? 'not-allowed' : 'pointer',
    width: '100%', transition: 'all .2s',
    WebkitTapHighlightColor: 'transparent'
  }),
  sBtn: (active) => ({
    flex: 1, padding: '9px 2px', borderRadius: '8px',
    border: active ? '2px solid #6366F1' : '1px solid #1f2937',
    background: active ? 'rgba(99,102,241,.2)' : 'transparent',
    color: active ? '#A5B4FC' : '#6B7280',
    fontWeight: '700', fontSize: '.85rem', cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent'
  }),
  modeBtn: (active) => ({
    flex: 1, padding: '11px 6px', borderRadius: '10px',
    border: active ? '2px solid #6366F1' : '1px solid #1f2937',
    background: active ? 'rgba(99,102,241,.15)' : 'transparent',
    color: active ? '#A5B4FC' : '#6B7280',
    fontWeight: '700', fontSize: '.82rem', cursor: 'pointer',
    transition: 'all .2s', WebkitTapHighlightColor: 'transparent'
  }),
  diffBtn: (active, col) => ({
    flex: 1, padding: '9px 4px', borderRadius: '8px',
    border: active ? `2px solid ${col}` : '1px solid #1f2937',
    background: active ? `${col}22` : 'transparent',
    color: active ? col : '#6B7280',
    fontWeight: '700', fontSize: '.78rem', cursor: 'pointer',
    transition: 'all .2s', WebkitTapHighlightColor: 'transparent'
  })
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen]   = useState('home')
  const helpFromRef           = useRef('home')
  const [mode, setMode]       = useState('human')
  const [currency, setCurrency] = useState('USDT')
  const [stake, setStake]       = useState(5)
  const [status, setStatus]   = useState('')
  const [loading, setLoading] = useState(false)

  // multiplayer
  const [matchId, setMatchId]   = useState('')
  const [joinId, setJoinId]     = useState('')
  const [color, setColor]       = useState(null)
  const [result, setResult]     = useState(null)
  const [myTurnUI, setMyTurnUI] = useState(false)

  // vs computer
  const [playerColor, setPlayerColor] = useState('white')
  const [difficulty, setDifficulty]   = useState('medium')
  const [botThinking, setBotThinking] = useState(false)
  const [gameOver, setGameOver]       = useState(false)
  const [moveHistory, setMoveHistory] = useState([])
  const [lastMove, setLastMove]       = useState(null)

  // click-to-move
  const [selectedSq, setSelectedSq]     = useState(null)
  const [legalTargets, setLegalTargets] = useState([])

  // single chess instance — we force re-render by bumping a counter
  const chessRef  = useRef(new Chess())
  const [tick, setTick] = useState(0)  // bump to re-render board
  const wsRef     = useRef(null)
  const colorRef  = useRef(null)

  function bump() { setTick(t => t + 1) }

  useEffect(() => { tg?.ready(); tg?.expand() }, [])
  // ─── VS COMPUTER: bot move trigger ────────────────────────────────────────
  useEffect(() => {
    if (screen !== 'game' || mode !== 'computer' || gameOver) return
    const chess = chessRef.current
    const botCol = playerColor === 'white' ? 'b' : 'w'
    if (chess.turn() !== botCol || chess.isGameOver()) return

    setBotThinking(true)
    setStatus('🤖 Computer thinking...')

    const timer = setTimeout(() => {
      fetchAIMove(chess.fen(), difficulty).then(uci => {
        if (!uci) { setBotThinking(false); return }
        const from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci[4] || 'q'
        try {
         const move = chess.move({ from, to, promotion: promo })
        if (move) {
          playSoundForMove(move, chess)
          setLastMove({ from, to })
          setMoveHistory(h => [...h, move.san])
          checkComputerGameOver(chess)
          bump()
          if (!chess.isGameOver()) setStatus('⚡️ Your turn!')
          }
        } catch {}
        setBotThinking(false)
      })
    }, 300)

    return () => clearTimeout(timer)
  }, [tick, screen, mode, gameOver, playerColor, difficulty])

  function checkComputerGameOver(chess) {
    if (!chess.isGameOver()) return
    setGameOver(true)
    if (chess.isCheckmate()) {
      const winner = chess.turn() === 'w' ? 'black' : 'white'
      if (winner === playerColor) { sfx().win(); setStatus('🏆 You win! Checkmate!') }
      else                        { sfx().lose(); setStatus('💀 Computer wins!') }
    } else {
      sfx().draw()
      setStatus('½ Draw!')
    }
  }

function startVsComputer() {
    chessRef.current = new Chess()
    setGameOver(false); setBotThinking(false); setMoveHistory([])
    setResult(null); setSelectedSq(null); setLegalTargets([]); setLastMove(null)
    setScreen('game')
    setStatus(playerColor === 'white' ? '⚡️ Your turn!' : '🤖 Computer plays first...')
    sfx().gameStart()
    bump()
  }

  // ─── SQUARE TAP HANDLER (vs computer) ────────────────────────────────────
  function handleSquareTap(sq) {
    if (gameOver || botThinking) return
    const chess = chessRef.current
    const myCol = playerColor === 'white' ? 'w' : 'b'
    if (chess.turn() !== myCol) return

    // If tapping a legal target → execute move
    if (selectedSq && legalTargets.includes(sq)) {
      let move
      try { move = chess.move({ from: selectedSq, to: sq, promotion: 'q' }) }
      catch { setSelectedSq(null); setLegalTargets([]); return } 
if (!move) { setSelectedSq(null); setLegalTargets([]); return }
      playSoundForMove(move, chess)
      setLastMove({ from: selectedSq, to: sq })
      setMoveHistory(h => [...h, move.san])
      setSelectedSq(null); setLegalTargets([])
      bump()
      checkComputerGameOver(chess)
      return
    }

    // Select a piece
    const piece = chess.get(sq)
    if (piece && piece.color === myCol) {
      const moves = chess.moves({ square: sq, verbose: true })
      setSelectedSq(sq)
      setLegalTargets(moves.map(m => m.to))
    } else {
      setSelectedSq(null); setLegalTargets([])
    }
  }

  // ─── SQUARE TAP HANDLER (multiplayer) ────────────────────────────────────
  function handleMultiSquareTap(sq) {
    if (!myTurnUI || result) return
    const chess = chessRef.current
    const myChessCol = colorRef.current === 'white' ? 'w' : 'b'

    if (selectedSq && legalTargets.includes(sq)) {
      const probe = new Chess(chess.fen())
      let move
      try { move = probe.move({ from: selectedSq, to: sq, promotion: 'q' }) }
      catch { setSelectedSq(null); setLegalTargets([]); return }
      if (!move) { setSelectedSq(null); setLegalTargets([]); return }

      // Optimistic update
      playSoundForMove(move, probe)
      chessRef.current = probe
      setLastMove({ from: selectedSq, to: sq })
      setSelectedSq(null); setLegalTargets([])
      setMyTurnUI(false); setStatus('⏳ Sending move...')
      bump()

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'move', move: selectedSq + sq + (move.promotion || '') }))
      } else {
        setStatus('❌ Not connected'); setMyTurnUI(true)
      }
      return
    }

    const piece = chess.get(sq)
    if (piece && piece.color === myChessCol) {
      const moves = chess.moves({ square: sq, verbose: true })
      setSelectedSq(sq); setLegalTargets(moves.map(m => m.to))
    } else {
      setSelectedSq(null); setLegalTargets([])
    }
  }

  // ─── MULTIPLAYER ──────────────────────────────────────────────────────────
  function applyServerFen(newFen) {
    try { chessRef.current = new Chess(newFen); bump() }
    catch (e) { console.error('Bad FEN', e) }
  }

  async function createMatch() {
    setLoading(true); setStatus('Creating...')
    try {
      const res = await fetch(API + '/api/match/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-init-data': 'test' },
        body: JSON.stringify({ stake, currency })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(JSON.stringify(data))
      setMatchId(data.match_id)
      colorRef.current = 'white'; setColor('white')
      setScreen('lobby'); connect(data.match_id, 'white')
    } catch (e) { setStatus('Error: ' + e.message) }
    setLoading(false)
  }

  async function joinMatch() {
    if (!joinId.trim()) { setStatus('Enter match ID'); return }
    setLoading(true)
    try {
      const res = await fetch(API + '/api/match/' + joinId.trim() + '/join', {
        method: 'POST', headers: { 'x-init-data': 'test' }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(JSON.stringify(data))
      colorRef.current = 'black'; setColor('black')
      setScreen('game'); connect(joinId.trim(), 'black')
    } catch (e) { setStatus('Error: ' + e.message) }
    setLoading(false)
  }

  function connect(mid, clr) {
    const sock = new WebSocket(WSS + '/ws/' + mid + '/' + clr)
    wsRef.current = sock
    sock.onopen = () => setStatus(clr === 'white' ? '⏳ Waiting for opponent...' : '⚡️ Game on!')
    sock.onmessage = (evt) => {
      const msg = JSON.parse(evt.data)
      const myClr = colorRef.current
      if (msg.type === 'connected') {
        applyServerFen(msg.fen); setScreen('game')
        const mine = msg.turn === myClr
        setMyTurnUI(mine)
        setStatus(mine ? '⚡️ Your turn!' : '⏳ Waiting for opponent...')
        return
      }
      if (msg.type === 'state') {
        applyServerFen(msg.fen)
        if (msg.last_move) setLastMove({ from: msg.last_move.slice(0,2), to: msg.last_move.slice(2,4) })
        setSelectedSq(null); setLegalTargets([])
        const mine = msg.turn === myClr
        setMyTurnUI(mine && !msg.game_over)
        if (msg.game_over && msg.result) endMultiGame(msg.result, myClr)
        else setStatus(mine ? '⚡️ Your turn!' : '⏳ Opponent thinking...')
        return
      }
      if (msg.type === 'error') {
        if (msg.fen) applyServerFen(msg.fen)
        setSelectedSq(null); setLegalTargets([])
        const mine = msg.turn ? msg.turn === myClr : myTurnUI
        setMyTurnUI(mine)
        setStatus('⚠️ ' + (msg.msg || 'Move rejected'))
        return
      }
      if (msg.type === 'gameover') endMultiGame(msg, myClr)
    }
    sock.onclose = () => setStatus('🔌 Disconnected')
    sock.onerror = () => setStatus('❌ Connection error')
  }

  function endMultiGame(r, clr) {
    setMyTurnUI(false); setResult(r)
    setSelectedSq(null); setLegalTargets([])
    if (!r.winner) setStatus('½ Draw!')
    else if (r.winner === clr) setStatus(`🏆 YOU WIN! +${cfg.symbol}${(stake * 2 * 0.9).toFixed(cfg.decimals)} ${cfg.unit}`)
    else setStatus('💀 You lost.')
  }

  function reset() {
    if (wsRef.current) wsRef.current.close()
    chessRef.current = new Chess()
    wsRef.current = null; colorRef.current = null
    setScreen('home'); setMyTurnUI(false); setColor(null); setResult(null)
    setMatchId(''); setJoinId(''); setStatus(''); setLoading(false)
    setGameOver(false); setBotThinking(false); setMoveHistory([])
    setSelectedSq(null); setLegalTargets([]); setLastMove(null)
    bump()
  }

  const cfg  = CURRENCY_CONFIG[currency]
  const pool = stake * 2, win = pool * 0.9, fee = pool * 0.1
  const isBot = mode === 'computer'

  // ─── CHECK HIGHLIGHTING ───────────────────────────────────────────────────
  // Find the king square of whoever is in check, so ChessBoard can flash it red.
  // Derived from chessRef — safe read-only, no mutations.
  function getCheckedKingSq() {
    const chess = chessRef.current
    if (!chess.isCheck()) return null
    const turn = chess.turn()   // the side currently in check
    for (const rank of ['1','2','3','4','5','6','7','8']) {
      for (const file of ['a','b','c','d','e','f','g','h']) {
        const sq = file + rank
        const p = chess.get(sq)
        if (p && p.type === 'k' && p.color === turn) return sq
      }
    }
    return null
  }
  const checkedKingSq = (screen === 'game') ? getCheckedKingSq() : null

  // ─── HOME ─────────────────────────────────────────────────────────────────
  if (screen === 'home') return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%', maxWidth: 440 }}>
        <div style={{ fontSize: 52, lineHeight: 1 }}>♟</div>
        <button onPointerDown={() => setScreen('profile')} style={{ background: 'rgba(99,102,241,.12)', border: '1px solid rgba(99,102,241,.25)', borderRadius: 10, padding: '8px 14px', color: '#A5B4FC', fontWeight: 700, fontSize: '.78rem', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', marginTop: 6 }}>
          👤 My Account
        </button>
      </div>
      <h1 style={{ fontSize: '1.9rem', fontWeight: 900, color: '#818CF8', letterSpacing: '-1px', margin: 0 }}>
        CHESS ARENA
      </h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <p style={{ color: '#6B7280', fontSize: '.8rem', margin: 0 }}>@{tgUser.username || 'Player'}</p>
        <button onPointerDown={() => { helpFromRef.current = 'home'; setScreen('help') }}
          style={{ background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.3)', color: '#818CF8', borderRadius: '50%', width: 28, height: 28, fontWeight: 800, fontSize: '.85rem', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', flexShrink: 0 }}>
          ?
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 440 }}>
        <button onPointerDown={() => setMode('computer')} style={S.modeBtn(mode === 'computer')}>🤖 vs Computer</button>
        <button onPointerDown={() => setMode('human')}    style={S.modeBtn(mode === 'human')}>⚔️ vs Human</button>
      </div>

      {mode === 'computer' && (
        <div style={S.box}>
          <p style={{ color: '#6B7280', fontSize: '.72rem', fontWeight: 700, letterSpacing: '1px', marginBottom: 10 }}>PLAY AS</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button onPointerDown={() => setPlayerColor('white')} style={S.diffBtn(playerColor === 'white', '#F9FAFB')}>♙ White</button>
            <button onPointerDown={() => setPlayerColor('black')} style={S.diffBtn(playerColor === 'black', '#818CF8')}>♟ Black</button>
          </div>
          <p style={{ color: '#6B7280', fontSize: '.72rem', fontWeight: 700, letterSpacing: '1px', marginBottom: 10 }}>DIFFICULTY</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button onPointerDown={() => setDifficulty('easy')}   style={S.diffBtn(difficulty === 'easy',   '#10B981')}>🟢 Easy</button>
            <button onPointerDown={() => setDifficulty('medium')} style={S.diffBtn(difficulty === 'medium', '#F59E0B')}>🟡 Medium</button>
            <button onPointerDown={() => setDifficulty('hard')}   style={S.diffBtn(difficulty === 'hard',   '#EF4444')}>🔴 Hard</button>
          </div>
          {difficulty === 'easy' && (
            <p style={{ color: '#10B981', fontSize: '.7rem', margin: '8px 0 14px' }}>
              💡 Easy shows all possible moves when you tap a piece
            </p>
          )}
          <button onPointerDown={startVsComputer} style={S.btn('linear-gradient(135deg,#6366F1,#8B5CF6)', false)}>
            🤖 Play vs Computer
          </button>
        </div>
      )}

      {mode === 'human' && (
        <>
          <div style={S.box}>
            {/* Currency selector */}
          <p style={{ color: '#6B7280', fontSize: '.72rem', fontWeight: 700, letterSpacing: '1px', marginBottom: 8 }}>CURRENCY</p>
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {Object.entries(CURRENCY_CONFIG).map(([key, c]) => (
              <button key={key} onPointerDown={() => { setCurrency(key); setStake(c.stakes[1]) }}
                style={{
                  flex: 1, padding: '8px 4px', borderRadius: 8,
                  border: currency === key ? `2px solid ${c.color}` : '1px solid #1f2937',
                  background: currency === key ? `${c.color}22` : 'transparent',
                  color: currency === key ? c.color : '#6B7280',
                  fontWeight: 700, fontSize: '.8rem', cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent'
                }}>
                {c.icon} {key}
              </button>
            ))}
          </div>
          <p style={{ color: '#4B5563', fontSize: '.68rem', margin: '-8px 0 12px' }}>{cfg.description}</p>

          {/* Stake selector — amounts change per currency */}
          <p style={{ color: '#6B7280', fontSize: '.72rem', fontWeight: 700, letterSpacing: '1px', marginBottom: '10px' }}>
            SET STAKE ({cfg.unit})
          </p>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
            {cfg.stakes.map(v => (
              <button key={v} onPointerDown={() => setStake(v)} style={S.sBtn(stake === v)}>
                {cfg.symbol}{v}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', textAlign: 'center', background: '#1a2236', borderRadius: '8px', padding: '12px' }}>
            <div><div style={{ color: '#6B7280', fontSize: '.7rem', marginBottom: 3 }}>Pool</div><div style={{ color: '#A5B4FC', fontWeight: 800 }}>{cfg.symbol}{pool.toFixed(cfg.decimals)}</div></div>
            <div><div style={{ color: '#6B7280', fontSize: '.7rem', marginBottom: 3 }}>You Win</div><div style={{ color: '#10B981', fontWeight: 800 }}>{cfg.symbol}{win.toFixed(cfg.decimals)}</div></div>
            <div><div style={{ color: '#6B7280', fontSize: '.7rem', marginBottom: 3 }}>Fee</div><div style={{ color: '#6B7280', fontWeight: 800 }}>{cfg.symbol}{fee.toFixed(cfg.decimals)}</div></div>
          </div>
          </div>
          <button onPointerDown={createMatch} disabled={loading} style={S.btn('linear-gradient(135deg,#6366F1,#8B5CF6)', loading)}>
            {loading ? 'Creating...' : '⚔️ Create New Match'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', maxWidth: 440 }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.06)' }} />
            <span style={{ color: '#4B5563', fontSize: '.78rem', fontWeight: 600 }}>OR JOIN</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,.06)' }} />
          </div>
          <div style={S.box}>
            <p style={{ color: '#6B7280', fontSize: '.72rem', fontWeight: 700, letterSpacing: '1px', marginBottom: '10px' }}>JOIN WITH MATCH ID</p>
            <input value={joinId} onChange={e => setJoinId(e.target.value)} placeholder="Paste match ID here..."
              style={{ width: '100%', background: '#0f1f3d', border: '1px solid #1a3a5c', borderRadius: '8px', padding: '11px', color: '#eaeaea', fontSize: '.9rem', marginBottom: '10px', boxSizing: 'border-box' }} />
            <button onPointerDown={joinMatch} disabled={loading || !joinId.trim()} style={S.btn('linear-gradient(135deg,#3B82F6,#6366F1)', loading || !joinId.trim())}>
              {loading ? 'Joining...' : '🚀 Join Match'}
            </button>
          </div>
        </>
      )}

      {status && (
        <div style={{ background: 'rgba(99,102,241,.1)', border: '1px solid rgba(99,102,241,.3)', borderRadius: '8px', padding: '10px 16px', color: '#A5B4FC', fontSize: '.85rem', textAlign: 'center', width: '100%', maxWidth: 440 }}>
          {status}
        </div>
      )}
    </div>
  )

  // ─── PROFILE ──────────────────────────────────────────────────────────────
  if (screen === 'profile') return <ProfileScreen onBack={() => setScreen('home')} />

// ─── HELP ─────────────────────────────────────────────────────────────────
  if (screen === 'help') {
    const Section = ({ title, children }) => (
      <div style={{ ...S.box, marginBottom: 0 }}>
        <p style={{ color: '#818CF8', fontSize: '.78rem', fontWeight: 800, letterSpacing: '1px', marginBottom: 10 }}>{title}</p>
        {children}
      </div>
    )
    const Row = ({ label, value, color = '#A5B4FC' }) => (
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
        <span style={{ color: '#6B7280', fontSize: '.82rem' }}>{label}</span>
        <span style={{ color, fontSize: '.82rem', fontWeight: 700 }}>{value}</span>
      </div>
    )
    const P = ({ children }) => (
      <p style={{ color: '#9CA3AF', fontSize: '.82rem', lineHeight: 1.6, margin: '0 0 8px' }}>{children}</p>
    )

    return (
      <div style={{ ...S.page, gap: 10 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: 440 }}>
          <button onPointerDown={() => setScreen(helpFromRef.current)}
            style={{ background: 'transparent', border: '1px solid #1f2937', color: '#6B7280', padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: '.82rem', WebkitTapHighlightColor: 'transparent' }}>
            ← Back
          </button>
          <span style={{ fontWeight: 800, color: '#818CF8', fontSize: '.95rem' }}>📖 Help & Rules</span>
          <div style={{ width: 60 }} />
        </div>

        {/* How to Play */}
        <Section title="♟ HOW TO PLAY">
          <P>Tap any of your pieces to select it. Legal moves appear as dots on the board. Tap a dot to move there. Tap a different piece to switch selection.</P>
          <P>Capture squares show a ring around the enemy piece. The goal is to checkmate the opponent's king — trap it so it cannot escape.</P>
        </Section>

        {/* Move Highlighting */}
        <Section title="🎨 BOARD COLOURS">
          <Row label="🟨 Yellow / Brown" value="Normal squares" />
          <Row label="🟩 Green" value="Last move (from → to)" color="#a3e635" />
          <Row label="🟪 Purple" value="Selected piece" color="#818CF8" />
          <Row label="🔴 Red" value="King in check" color="#EF4444" />
          <Row label="⚪ White dot" value="Legal move target" />
          <Row label="🟢 Green dot" value="Legal move (Easy mode hint)" color="#10B981" />
        </Section>

        {/* Piece Values */}
        <Section title="♟ PIECE VALUES">
          <Row label="♙ Pawn"   value="1 point" />
          <Row label="♘ Knight" value="3 points" />
          <Row label="♗ Bishop" value="3 points" />
          <Row label="♖ Rook"   value="5 points" />
          <Row label="♕ Queen"  value="9 points" />
          <Row label="♔ King"   value="∞ — protect at all costs" color="#EF4444" />
        </Section>

        {/* Currency & Payments */}
        <Section title="💰 CURRENCIES">
          {Object.entries(CURRENCY_CONFIG).map(([key, c]) => (
            <Row key={key} label={`${c.icon} ${key}`} value={c.description.split('—')[0].trim()} color={c.color} />
          ))}
          <P style={{ marginTop: 8 }}>All balances are held in a secure escrow on the server. Stakes are locked the moment both players join. You are never charged unless a complete match is played.</P>
        </Section>

        {/* Prize Structure */}
        <Section title="🏆 PRIZE STRUCTURE">
          <P>When you win a match:</P>
          <Row label="Your stake" value="Returned" color="#10B981" />
          <Row label="Opponent's stake" value="90% to you" color="#10B981" />
          <Row label="Platform fee" value="10% rake" color="#6B7280" />
          <P>On a draw, both players receive their original stake back. No rake is charged on draws.</P>
        </Section>

        {/* Difficulty */}
        <Section title="🤖 VS COMPUTER MODES">
          <Row label="🟢 Easy"   value="Random legal moves — perfect for beginners" />
          <Row label="🟡 Medium" value="2-ply minimax — plays solid, won't blunder big pieces" />
          <Row label="🔴 Hard"   value="3-ply minimax + alpha-beta — tactical, punishes mistakes" />
          <P>Computer moves are computed locally on your device — no internet needed, instant response.</P>
        </Section>

        {/* Security */}
        <Section title="🔒 SECURITY">
          <P>Your Telegram identity is verified with HMAC-SHA256 on every request. Stakes are validated server-side — the frontend never controls financial logic. All payouts are atomic — a match can only be settled once.</P>
          <P>If you disconnect mid-game, your opponent wins automatically. If both players disconnect simultaneously, stakes are refunded.</P>
        </Section>

        <button onPointerDown={() => setScreen(helpFromRef.current)}
          style={{ ...S.btn('linear-gradient(135deg,#6366F1,#8B5CF6)', false), maxWidth: 440 }}>
          ← Back to Game
        </button>
      </div>
    )
  }

  // ─── LOBBY ────────────────────────────────────────────────────────────────
  if (screen === 'lobby') return (
    <div style={S.page}>
      <div style={{ fontSize: 52 }}>⚔️</div>
      <h2 style={{ fontWeight: 800, color: '#818CF8', fontSize: '1.4rem', margin: 0 }}>Match Created!</h2>
      <p style={{ color: '#6B7280', fontSize: '.85rem', margin: 0 }}>Share this ID with your opponent</p>
      <div style={{ ...S.box, textAlign: 'center' }}>
        <p style={{ color: '#6B7280', fontSize: '.72rem', fontWeight: 700, letterSpacing: '1px', marginBottom: 10 }}>MATCH ID</p>
        <div style={{ background: '#0f1f3d', border: '1px solid #1a3a5c', borderRadius: '8px', padding: '12px', fontFamily: 'monospace', fontSize: '.8rem', wordBreak: 'break-all', color: '#A5B4FC', marginBottom: 12 }}>
          {matchId}
        </div>
        <button onPointerDown={() => { navigator.clipboard.writeText(matchId); setStatus('✅ Copied!') }}
          style={S.btn('linear-gradient(135deg,#3B82F6,#6366F1)', false)}>📋 Copy Match ID</button>
      </div>
      <div style={{ color: '#6B7280', fontSize: '.85rem' }}>⏳ Waiting for opponent...</div>
      {status && <div style={{ color: '#10B981', fontSize: '.85rem' }}>{status}</div>}
      <button onPointerDown={reset} style={{ background: 'transparent', border: '1px solid #1f2937', color: '#6B7280', padding: '10px 24px', borderRadius: '8px', cursor: 'pointer', fontSize: '.85rem' }}>← Cancel</button>
    </div>
  )

  // ─── GAME ─────────────────────────────────────────────────────────────────
  const boardOri   = isBot ? playerColor : (color === 'black' ? 'black' : 'white')
  const humanTurn  = isBot
    ? (!gameOver && !botThinking && chessRef.current.turn() === (playerColor === 'white' ? 'w' : 'b'))
    : (myTurnUI && !result)
  const showHints  = isBot && difficulty === 'easy'

  return (
    <div style={{ ...S.page, padding: '10px 10px 28px', gap: 10 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', maxWidth: 460 }}>
        <div>
          <div style={{ fontWeight: 800, color: '#818CF8', fontSize: '.9rem' }}>♟ CHESS ARENA</div>
          <div style={{ color: '#6B7280', fontSize: '.72rem' }}>
            {isBot
              ? <>You play <strong style={{ color: '#A5B4FC' }}>{playerColor}</strong> · {difficulty}</>
              : <>You are <strong style={{ color: '#A5B4FC' }}>{color}</strong> · ${stake} stake</>
            }
          </div>
        </div>
        <div style={{
          background: botThinking ? 'rgba(245,158,11,.12)' : humanTurn ? 'rgba(16,185,129,.12)' : 'rgba(99,102,241,.12)',
          border: `1px solid ${botThinking ? 'rgba(245,158,11,.4)' : humanTurn ? 'rgba(16,185,129,.4)' : 'rgba(99,102,241,.4)'}`,
          borderRadius: 8, padding: '5px 12px', fontSize: '.75rem', fontWeight: 700,
          color: botThinking ? '#F59E0B' : humanTurn ? '#10B981' : '#A5B4FC'
        }}>
          {botThinking ? '🤖 Thinking' : humanTurn ? '⚡️ Your turn' : '⏳ Waiting'}
        </div>
      </div>

      {/* Status */}
      <div style={{
        background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.2)',
        borderRadius: 10, padding: '9px 16px', fontSize: '.85rem', fontWeight: 600,
        textAlign: 'center', width: '100%', maxWidth: 460, color: '#A5B4FC', boxSizing: 'border-box'
      }}>
        {status || '♟ Game in progress'}
      </div>

      {/* Custom board */}
      <div style={{ width: 'min(460px, calc(100vw - 20px))' }}>
        <ChessBoard
          chess={chessRef.current}
          orientation={boardOri}
          selectedSq={humanTurn ? selectedSq : null}
          legalTargets={humanTurn ? legalTargets : []}
          onSquareTap={isBot ? handleSquareTap : handleMultiSquareTap}
          showHints={showHints}
          lastMove={lastMove}
          checkedKingSq={checkedKingSq}
        />
      </div>

      {/* Easy mode hint label */}
      {showHints && humanTurn && !gameOver && (
        <div style={{ color: '#10B981', fontSize: '.72rem', textAlign: 'center', opacity: 0.85 }}>
          💡 Tap any piece to see where it can move
        </div>
      )}

      {/* Move history */}
      {isBot && moveHistory.length > 0 && (
        <div style={{ ...S.box, maxHeight: 68, overflowY: 'auto', padding: '10px 14px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {moveHistory.map((m, i) => (
              <span key={i} style={{
                background: i % 2 === 0 ? 'rgba(255,255,255,.06)' : 'rgba(99,102,241,.12)',
                color: i % 2 === 0 ? '#9CA3AF' : '#A5B4FC',
                padding: '2px 7px', borderRadius: 4, fontSize: '.72rem', fontWeight: 600
              }}>
                {i % 2 === 0 ? `${Math.floor(i/2)+1}.` : ''}{m}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Prize bar */}
      {!isBot && (
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: 460, background: '#111827', border: '1px solid rgba(255,255,255,.06)', borderRadius: 12, padding: '10px 16px', boxSizing: 'border-box' }}>
          <div>
            <div style={{ color: '#6B7280', fontSize: '.7rem' }}>Prize Pool</div>
          <div style={{ color: '#10B981', fontWeight: 800 }}>{cfg.symbol}{pool.toFixed(cfg.decimals)} {cfg.unit}</div>
          </div>
          <div style={{ width: 1, background: 'rgba(255,255,255,.06)' }} />
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#6B7280', fontSize: '.7rem' }}>Winner Gets</div>
            <div style={{ color: '#A5B4FC', fontWeight: 800 }}>{cfg.symbol}{win.toFixed(cfg.decimals)} {cfg.unit}</div>
          </div>
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 10, width: '100%', maxWidth: 460 }}>
        {(result || gameOver) && (
          <button onPointerDown={isBot ? startVsComputer : reset}
            style={{ ...S.btn('linear-gradient(135deg,#6366F1,#8B5CF6)', false), flex: 1 }}>
            🔄 Play Again
          </button>
        )}
        <button onPointerDown={reset}
          style={{ flex: result || gameOver ? '0 0 auto' : 1, padding: '13px 20px', background: 'transparent', border: '1px solid #1f2937', color: '#6B7280', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '.85rem', WebkitTapHighlightColor: 'transparent' }}>
          ← Home
        </button>
      </div>
    </div>
  )
}
