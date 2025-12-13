"""Provider abstraction layer for sandbox VM providers (Morph, Freestyle)."""

from __future__ import annotations

from .base import (
    BaseInstance,
    BaseProvider,
    BaseSnapshot,
    ExecResponse,
    PortMapping,
    ProviderType,
)
from .freestyle import FreestyleInstance, FreestyleProvider, FreestyleSnapshot
from .morph import MorphInstance, MorphProvider, MorphSnapshot


def get_provider(provider_type: ProviderType | str) -> BaseProvider:
    """Factory function to get a provider by type.

    Args:
        provider_type: Either a ProviderType enum or string ("morph", "freestyle")

    Returns:
        An instance of the appropriate provider

    Raises:
        ValueError: If provider type is unknown
    """
    if isinstance(provider_type, str):
        provider_type = ProviderType(provider_type)

    match provider_type:
        case ProviderType.MORPH:
            return MorphProvider()
        case ProviderType.FREESTYLE:
            return FreestyleProvider()

    raise ValueError(f"Unknown provider type: {provider_type}")


__all__ = [
    # Base classes
    "BaseInstance",
    "BaseProvider",
    "BaseSnapshot",
    "ExecResponse",
    "PortMapping",
    "ProviderType",
    # Freestyle
    "FreestyleInstance",
    "FreestyleProvider",
    "FreestyleSnapshot",
    # Morph
    "MorphInstance",
    "MorphProvider",
    "MorphSnapshot",
    # Factory
    "get_provider",
]
