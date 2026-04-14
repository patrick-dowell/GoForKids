"""
Glicko-2 rating system for ranked games.
Simplified implementation for single-player vs AI ladder.
"""

from __future__ import annotations
import math
from dataclasses import dataclass

# Constants
TAU = 0.5  # System constant (constrains volatility)
EPSILON = 0.000001


@dataclass
class Rating:
    """Player rating in Glicko-2."""
    mu: float = 1500.0       # Rating (Glicko-1 scale)
    phi: float = 350.0       # Rating deviation
    sigma: float = 0.06      # Volatility

    @property
    def display_rating(self) -> int:
        return round(self.mu)

    @property
    def confidence_interval(self) -> tuple[int, int]:
        """95% confidence interval."""
        low = round(self.mu - 2 * self.phi)
        high = round(self.mu + 2 * self.phi)
        return (low, high)

    def to_go_rank(self) -> str:
        """Convert Glicko rating to approximate Go rank string."""
        # Rough mapping: 1500 = ~15k, each 100 points ~ 1 rank
        rank_num = max(1, round((2000 - self.mu) / 100) + 5)
        if rank_num > 30:
            rank_num = 30
        if rank_num <= 0:
            return f"{abs(rank_num) + 1}d"
        return f"{rank_num}k"

    def to_dict(self) -> dict:
        return {
            "mu": self.mu,
            "phi": self.phi,
            "sigma": self.sigma,
            "display_rating": self.display_rating,
            "go_rank": self.to_go_rank(),
        }


def _g(phi: float) -> float:
    return 1 / math.sqrt(1 + 3 * phi ** 2 / math.pi ** 2)


def _E(mu: float, mu_j: float, phi_j: float) -> float:
    return 1 / (1 + math.exp(-_g(phi_j) * (mu - mu_j)))


def update_rating(player: Rating, opponent_mu: float, opponent_phi: float, score: float) -> Rating:
    """
    Update a player's rating after a single game.

    score: 1.0 for win, 0.0 for loss, 0.5 for draw
    """
    # Step 1: Convert to Glicko-2 scale
    mu = (player.mu - 1500) / 173.7178
    phi = player.phi / 173.7178
    opp_mu = (opponent_mu - 1500) / 173.7178
    opp_phi = opponent_phi / 173.7178

    # Step 2: Compute variance
    g_phi = _g(opp_phi)
    E_val = 1 / (1 + math.exp(-g_phi * (mu - opp_mu)))
    v = 1 / (g_phi ** 2 * E_val * (1 - E_val))

    # Step 3: Compute delta
    delta = v * g_phi * (score - E_val)

    # Step 4: Update volatility (simplified Illinois algorithm)
    a = math.log(player.sigma ** 2)
    phi2 = phi ** 2

    def f(x):
        ex = math.exp(x)
        return (ex * (delta ** 2 - phi2 - v - ex)) / (2 * (phi2 + v + ex) ** 2) - (x - a) / TAU ** 2

    A = a
    if delta ** 2 > phi2 + v:
        B = math.log(delta ** 2 - phi2 - v)
    else:
        k = 1
        while f(a - k * TAU) < 0:
            k += 1
        B = a - k * TAU

    fA = f(A)
    fB = f(B)

    for _ in range(100):  # Max iterations
        if abs(B - A) < EPSILON:
            break
        C = A + (A - B) * fA / (fB - fA)
        fC = f(C)
        if fC * fB <= 0:
            A = B
            fA = fB
        else:
            fA /= 2
        B = C
        fB = fC

    new_sigma = math.exp(A / 2)

    # Step 5: Update rating deviation
    phi_star = math.sqrt(phi2 + new_sigma ** 2)

    # Step 6: Update rating
    new_phi = 1 / math.sqrt(1 / phi_star ** 2 + 1 / v)
    new_mu = mu + new_phi ** 2 * g_phi * (score - E_val)

    # Convert back to Glicko-1 scale
    return Rating(
        mu=new_mu * 173.7178 + 1500,
        phi=new_phi * 173.7178,
        sigma=new_sigma,
    )


def rank_to_rating(rank: str) -> float:
    """Convert a Go rank string to approximate Glicko rating."""
    rank = rank.strip().lower()
    if rank.endswith("k"):
        kyu = int(rank[:-1])
        return 2000 - (kyu - 5) * 100  # 5k = 2000, 15k = 1000
    elif rank.endswith("d"):
        dan = int(rank[:-1])
        return 2000 + dan * 100  # 1d = 2100
    return 1500  # Default
