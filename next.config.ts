import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    allowedDevOrigins: ['10.0.1.77'],
    // Кнопка Next.js в dev-режиме иначе перекрывает низ сайдбара.
    devIndicators: { position: 'bottom-right' },
};

export default nextConfig;
