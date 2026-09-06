"use client";

import React, { useState } from 'react';

interface NavLink {
    label: string;
    href: string;
    isActive?: boolean;
}

interface Partner {
    logoUrl: string;
    href: string;
}

interface ResponsiveHeroBannerProps {
    logoUrl?: string;
    backgroundImageUrl?: string;
    navLinks?: NavLink[];
    ctaButtonText?: string;
    ctaButtonHref?: string;
    badgeText?: string;
    badgeLabel?: string;
    title?: string;
    titleLine2?: string;
    description?: string;
    primaryButtonText?: string;
    primaryButtonHref?: string;
    secondaryButtonText?: string;
    secondaryButtonHref?: string;
    partnersTitle?: string;
    partners?: Partner[];
    onPrimaryClick?: () => void;
    onSecondaryClick?: () => void;
}

export const ResponsiveHeroBanner: React.FC<ResponsiveHeroBannerProps> = ({
    logoUrl: _logoUrl = "https://cdn.21st.dev/assets/mirror/c4/c4d5f159140e3ccc35a8bd4f043453cb9e2692f700206e43855ff598c171b924.png",
    backgroundImageUrl = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2000&auto=format&fit=crop",
    navLinks: _navLinks = [
        { label: "Overview", href: "#", isActive: true },
        { label: "Remedies", href: "#" },
        { label: "Simulation", href: "#" },
        { label: "Compare", href: "#" }
    ],
    ctaButtonText: _ctaButtonText = "Run Remedy",
    ctaButtonHref: _ctaButtonHref = "#",
    badgeLabel = "REMEDY LAB",
    badgeText = "AI Incident Resolution Laboratory",
    title = "From Root Cause to",
    titleLine2 = "Tested Resolution",
    description = "Test proposed remediation strategies against an isolated simulation fork of the incident state before applying changes to production.",
    primaryButtonText = "Generate AI Remedies",
    primaryButtonHref: _primaryButtonHref = "#",
    secondaryButtonText = "View Incident Graph",
    secondaryButtonHref: _secondaryButtonHref = "#",
    partnersTitle: _partnersTitle = "Grounded in true telemetry physics & Gemini analysis",
    partners: _partners = [],
    onPrimaryClick,
    onSecondaryClick
}) => {
    return (
        <section className="w-full isolate min-h-[360px] overflow-hidden relative rounded-2xl border border-amber-500/30 bg-neutral-950 shadow-2xl mb-8">
            <div className="w-full h-full absolute inset-0 bg-gradient-to-r from-neutral-950 via-neutral-950/90 to-amber-950/40 z-0" />
            <img
                src={backgroundImageUrl}
                alt=""
                className="w-full h-full object-cover absolute top-0 right-0 bottom-0 left-0 opacity-20 mix-blend-luminosity z-0 pointer-events-none"
            />
            <div className="pointer-events-none absolute inset-0 ring-1 ring-amber-500/20 rounded-2xl z-0" />

            <div className="z-10 relative p-8 md:p-12">
                <div className="max-w-4xl">
                    <div className="mb-4 inline-flex items-center gap-3 rounded-full bg-amber-500/10 px-3 py-1.5 ring-1 ring-amber-500/30 backdrop-blur">
                        <span className="inline-flex items-center text-xs font-mono font-bold text-amber-400 bg-amber-500/20 rounded-full py-0.5 px-2.5">
                            {badgeLabel}
                        </span>
                        <span className="text-xs font-mono font-medium text-amber-200/90">
                            {badgeText}
                        </span>
                    </div>

                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white leading-tight font-sans">
                        {title} <span className="text-amber-400 font-serif italic">{titleLine2}</span>
                    </h1>

                    <p className="text-sm sm:text-base text-neutral-300 max-w-2xl mt-4 font-mono leading-relaxed">
                        {description}
                    </p>

                    <div className="flex flex-wrap gap-4 mt-8 items-center">
                        <button
                            onClick={onPrimaryClick}
                            className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-950 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 rounded-xl py-3 px-6 shadow-lg shadow-amber-500/20 transition-all transform hover:-translate-y-0.5"
                        >
                            {primaryButtonText}
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                                <path d="M5 12h14" />
                                <path d="m12 5 7 7-7 7" />
                            </svg>
                        </button>
                        
                        {secondaryButtonText && (
                            <button
                                onClick={onSecondaryClick}
                                className="inline-flex items-center gap-2 rounded-xl bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-700/80 px-5 py-3 text-sm font-mono text-neutral-200 hover:text-white transition-colors"
                            >
                                {secondaryButtonText}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
};

export default ResponsiveHeroBanner;
