// The Immortal Game — Adolf Anderssen vs Lionel Kieseritzky, London, 21 June 1851.
// 23 moves, 45 plies, hardcoded as from/to squares. States are derived by replaying them.

export const PLIES = [
  // [from, to, SAN, annotation]
  ['e2', 'e4', 'e4', 'Anderssen opens with the king’s pawn. Nothing yet hints at immortality.'],
  ['e7', 'e5', 'e5', 'Kieseritzky answers in kind. The classical centre is set.'],
  ['f2', 'f4', 'f4', 'The King’s Gambit — a pawn offered on move two, in the romantic manner of the age.'],
  ['e5', 'f4', 'exf4', 'Accepted. Black takes the gambit pawn.'],
  ['f1', 'c4', 'Bc4', 'The Bishop’s Gambit. White aims at f7 and invites his king to be chased.'],
  ['d8', 'h4', 'Qh4+', 'Check. The black queen strikes, and White loses the right to castle.'],
  ['e1', 'f1', 'Kf1', 'The king steps aside. Anderssen will never castle in this game.'],
  ['b7', 'b5', 'b5', 'The Bryan Counter-Gambit: a pawn returned to lure the bishop away.'],
  ['c4', 'b5', 'Bxb5', 'Anderssen takes it. Material is level; time is not.'],
  ['g8', 'f6', 'Nf6', 'Black develops with a threat against e4.'],
  ['g1', 'f3', 'Nf3', 'The knight comes out and chases the queen from h4.'],
  ['h4', 'h6', 'Qh6', 'The queen retreats to h6, still watching the kingside.'],
  ['d2', 'd3', 'd3', 'Quiet and solid. e4 is defended; the dark-squared bishop can breathe.'],
  ['f6', 'h5', 'Nh5', 'The knight heads for g3, where it would fork the rook on h1.'],
  ['f3', 'h4', 'Nh4', 'Anderssen covers g2 and eyes the f5 square.'],
  ['h6', 'g5', 'Qg5', 'The queen attacks the knight on h4.'],
  ['h4', 'f5', 'Nf5', 'The knight lands on f5 — an outpost it will keep until the end.'],
  ['c7', 'c6', 'c6', 'Black strikes at the bishop on b5.'],
  ['g2', 'g4', 'g4', 'A pawn lunge at the knight on h5. The bishop is left hanging.'],
  ['h5', 'f6', 'Nf6', 'The knight falls back to f6.'],
  ['h1', 'g1', 'Rg1', 'Anderssen abandons the bishop. The sacrifices begin.'],
  ['c6', 'b5', 'cxb5', 'Kieseritzky takes it. White is a whole piece down.'],
  ['h2', 'h4', 'h4', 'The h-pawn drives at the black queen.'],
  ['g5', 'g6', 'Qg6', 'The queen retreats to g6.'],
  ['h4', 'h5', 'h5', 'Again. The queen is running out of squares.'],
  ['g6', 'g5', 'Qg5', 'Back to g5, where the net is waiting.'],
  ['d1', 'f3', 'Qf3', 'Quiet and deadly: Bxf4 would now trap the queen.'],
  ['f6', 'g8', 'Ng8', 'The knight retreats to g8 to give the queen a way out.'],
  ['c1', 'f4', 'Bxf4', 'The bishop wins back the gambit pawn, with tempo on the queen.'],
  ['g5', 'f6', 'Qf6', 'The queen escapes to f6.'],
  ['b1', 'c3', 'Nc3', 'Development. Every white piece now points at the black king.'],
  ['f8', 'c5', 'Bc5', 'Black develops with a threat of his own: Bxg1.'],
  ['c3', 'd5', 'Nd5', 'The knight leaps to d5, hitting the queen and the c7 square.'],
  ['f6', 'b2', 'Qxb2', 'The queen takes b2 and attacks both white rooks.'],
  ['f4', 'd6', 'Bd6!!', 'The immortal move. Anderssen offers both rooks and plays for mate.'],
  ['c5', 'g1', 'Bxg1', 'Kieseritzky takes the first rook.'],
  ['e4', 'e5', 'e5!', 'The pawn cuts the long diagonal: the queen can no longer guard g7.'],
  ['b2', 'a1', 'Qxa1+', 'The second rook falls, with check.'],
  ['f1', 'e2', 'Ke2', 'The king steps up. White is two rooks and a bishop down.'],
  ['b8', 'a6', 'Na6', 'Black covers c7. It is already too late.'],
  ['f5', 'g7', 'Nxg7+', 'The knight tears into g7 with check.'],
  ['e8', 'd8', 'Kd8', 'The king runs to d8.'],
  ['f3', 'f6', 'Qf6+!!', 'And now the queen is given away too.'],
  ['g8', 'f6', 'Nxf6', 'Forced. Black takes the queen.'],
  ['d6', 'e7', 'Be7#', 'Checkmate with three minor pieces — after giving up a queen, two rooks and a bishop.'],
];
export const PLY_COUNT = PLIES.length; // 45

export const EPILOGUE = 'The black king lies down. 1–0. Ernst Falkbeer named it the Immortal Game in 1855.';

// Squares that tell the story after the mate: the king, the three attackers, and the sealed escape squares.
export const MATE_NET = ['d8', 'e7', 'd5', 'g7', 'c7', 'e8', 'c8', 'd7', 'e7'];

export const FILES = 'abcdefgh';
export const TYPE_OF = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };
const BACK = 'RNBQKBNR';

/** 32 pieces keyed by colour + starting square, e.g. 'wg1' is White's king knight. */
export function initialPieces() {
  const out = [];
  for (let f = 0; f < 8; f++) {
    const file = FILES[f];
    out.push({ id: 'w' + file + '1', color: 'w', type: TYPE_OF[BACK[f]], start: file + '1' });
    out.push({ id: 'w' + file + '2', color: 'w', type: 'pawn', start: file + '2' });
    out.push({ id: 'b' + file + '7', color: 'b', type: 'pawn', start: file + '7' });
    out.push({ id: 'b' + file + '8', color: 'b', type: TYPE_OF[BACK[f]], start: file + '8' });
  }
  return out;
}

/**
 * Replays the game. states[k] = board before ply k (states[45] = final).
 * Each state: { sq: {pieceId: square}, grave: {pieceId: slotIndex} }. Each ply gets { mover, victim, check }.
 */
export function replay(pieces) {
  const board = {};
  for (const p of pieces) board[p.start] = p.id;
  const colorOf = Object.fromEntries(pieces.map(p => [p.id, p.color]));
  const typeOf = Object.fromEntries(pieces.map(p => [p.id, p.type]));
  const grave = {};
  const graveCount = { w: 0, b: 0 };
  const snapshot = () => {
    const sq = {};
    for (const [s, id] of Object.entries(board)) sq[id] = s;
    return { sq, grave: { ...grave } };
  };
  const states = [snapshot()];
  const plies = PLIES.map(([from, to, san, note], k) => {
    const mover = board[from];
    if (!mover) throw new Error(`ply ${k}: no piece on ${from}`);
    const side = k % 2 === 0 ? 'w' : 'b';
    if (colorOf[mover] !== side) throw new Error(`ply ${k}: ${from} holds the wrong colour`);
    if (!legalShape(typeOf[mover], side, from, to, !!board[to], board)) throw new Error(`ply ${k}: ${san} is not a legal ${typeOf[mover]} move`);
    const victim = board[to] ?? null;
    if (victim && colorOf[victim] === side) throw new Error(`ply ${k}: captures own piece`);
    if (san.includes('x') !== !!victim) throw new Error(`ply ${k}: capture mismatch in ${san}`);
    if (victim) { grave[victim] = graveCount[colorOf[victim]]++; }
    delete board[from];
    board[to] = mover;
    states.push(snapshot());
    return { k, from, to, san, note, mover, victim, check: /[+#]/.test(san), mate: san.includes('#'), knight: typeOf[mover] === 'knight', side };
  });
  return { states, plies };
}

// Geometric legality (enough to catch transcription errors): piece movement shape and clear paths.
function legalShape(type, side, from, to, capture, board) {
  const fx = FILES.indexOf(from[0]), fy = +from[1], tx = FILES.indexOf(to[0]), ty = +to[1];
  const dx = tx - fx, dy = ty - fy, ax = Math.abs(dx), ay = Math.abs(dy);
  const clear = () => {
    const sx = Math.sign(dx), sy = Math.sign(dy);
    for (let x = fx + sx, y = fy + sy; x !== tx || y !== ty; x += sx, y += sy) if (board[FILES[x] + y]) return false;
    return true;
  };
  switch (type) {
    case 'knight': return (ax === 1 && ay === 2) || (ax === 2 && ay === 1);
    case 'bishop': return ax === ay && ax > 0 && clear();
    case 'rook': return (ax === 0) !== (ay === 0) && clear();
    case 'queen': return (ax === ay || ax === 0 || ay === 0) && (ax + ay > 0) && clear();
    case 'king': return Math.max(ax, ay) === 1;
    case 'pawn': {
      const dir = side === 'w' ? 1 : -1, home = side === 'w' ? 2 : 7;
      if (capture) return ax === 1 && dy === dir;
      if (dx !== 0) return false;
      if (dy === dir) return true;
      return dy === 2 * dir && fy === home && !board[FILES[fx] + (fy + dir)];
    }
  }
  return false;
}

/** Square name -> board-space centre (square = 1 unit, a1 at (-3.5, +3.5), White at +z). */
export function squareXZ(sq) {
  return [FILES.indexOf(sq[0]) - 3.5, 4.5 - +sq[1]];
}
export function xzSquare(x, z) {
  const f = Math.round(x + 3.5), r = Math.round(4.5 - z);
  if (f < 0 || f > 7 || r < 1 || r > 8) return null;
  return FILES[f] + r;
}
