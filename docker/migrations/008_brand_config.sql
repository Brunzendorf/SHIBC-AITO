-- 008_brand_config.sql
-- White-label brand configuration for multi-tenant support
-- Brand values (colors, logos, socials) are stored here instead of hardcoded in profiles

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Brand configuration table
CREATE TABLE IF NOT EXISTS brand_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Project identifier (for multi-tenant)
    project_key VARCHAR(50) UNIQUE NOT NULL,  -- 'shibc', 'client-xyz'

    -- Basic Info
    name VARCHAR(100) NOT NULL,
    short_name VARCHAR(20) NOT NULL,
    tagline VARCHAR(255),

    -- Colors (JSON)
    colors JSONB NOT NULL DEFAULT '{
        "primary": "#fda92d",
        "secondary": "#8E33FF",
        "background": "#141A21",
        "accent": "#00B8D9",
        "text": "#FFFFFF"
    }',

    -- Logos (URLs or Directus File IDs)
    logos JSONB NOT NULL DEFAULT '{
        "main": null,
        "icon": null,
        "watermark": null
    }',

    -- Social Links
    socials JSONB NOT NULL DEFAULT '{
        "twitter": null,
        "telegram": null,
        "discord": null,
        "website": null
    }',

    -- Image Generation Style Guidelines
    image_style JSONB NOT NULL DEFAULT '{
        "aesthetic": "Professional, modern, tech-forward",
        "patterns": "Blockchain networks, connected nodes",
        "mascot": null,
        "defaultBranding": "text-footer"
    }',

    -- Contract/Token Info (for crypto projects)
    token_info JSONB DEFAULT '{
        "symbol": null,
        "contractAddress": null,
        "chain": null,
        "decimals": 18
    }',

    -- Active/Default flags
    is_active BOOLEAN DEFAULT true,
    is_default BOOLEAN DEFAULT false,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_brand_config_project_key ON brand_config(project_key);
CREATE INDEX IF NOT EXISTS idx_brand_config_is_default ON brand_config(is_default) WHERE is_default = true;

-- Seed default SHIBC configuration
INSERT INTO brand_config (
    project_key,
    name,
    short_name,
    tagline,
    colors,
    logos,
    socials,
    image_style,
    token_info,
    is_default
) VALUES (
    'shibc',
    'SHIBA CLASSIC',
    'SHIBC',
    'The Original',
    '{
        "primary": "#fda92d",
        "secondary": "#8E33FF",
        "background": "#141A21",
        "accent": "#00B8D9",
        "text": "#FFFFFF"
    }',
    '{
        "main": "https://shibaclassic.io/logo.png",
        "icon": "https://shibaclassic.io/icon.png",
        "watermark": "https://shibaclassic.io/watermark.png"
    }',
    '{
        "twitter": "@shibc_cto",
        "telegram": "t.me/shibaclassic",
        "discord": null,
        "website": "shibaclassic.io"
    }',
    '{
        "aesthetic": "Professional crypto, glassmorphism, blockchain patterns",
        "patterns": "Connected nodes, hexagonal grids, golden gradients",
        "mascot": "Golden Shiba Inu",
        "defaultBranding": "text-footer"
    }',
    '{
        "symbol": "SHIBC",
        "contractAddress": null,
        "chain": "ethereum",
        "decimals": 18
    }',
    true
) ON CONFLICT (project_key) DO UPDATE SET
    name = EXCLUDED.name,
    short_name = EXCLUDED.short_name,
    tagline = EXCLUDED.tagline,
    colors = EXCLUDED.colors,
    logos = EXCLUDED.logos,
    socials = EXCLUDED.socials,
    image_style = EXCLUDED.image_style,
    token_info = EXCLUDED.token_info,
    updated_at = NOW();

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_brand_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_brand_config_updated_at ON brand_config;
CREATE TRIGGER trigger_brand_config_updated_at
    BEFORE UPDATE ON brand_config
    FOR EACH ROW
    EXECUTE FUNCTION update_brand_config_updated_at();

-- Comment for documentation
COMMENT ON TABLE brand_config IS 'White-label brand configuration for multi-tenant support. Agents read CI values from here instead of hardcoded profiles.';
