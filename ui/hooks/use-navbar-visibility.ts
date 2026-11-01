"use client";

import { useEffect, useRef, useState } from "react";
import { useMediaQuery } from "react-responsive";
import { BREAKPOINTS } from "@/lib/config/breakpoints";

export function useNavbarVisibility() {
  const [isVisible, setIsVisible] = useState(true);
  const lastScrollYRef = useRef(0);
  const isMobile = useMediaQuery({ maxWidth: BREAKPOINTS.md - 1 });

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      // Don't hide if we're near the top (within 100px)
      if (currentScrollY < 100) {
        setIsVisible(true);
        lastScrollYRef.current = currentScrollY;
        return;
      }
      // Higher threshold on mobile (120px) vs desktop (80px) to accommodate swipe gestures
      const scrollThreshold = isMobile ? 120 : 80;
      // Check scroll direction with a threshold to avoid jank
      if (Math.abs(currentScrollY - lastScrollYRef.current) < scrollThreshold) {
        return;
      }
      if (currentScrollY > lastScrollYRef.current) {
        // Scrolling down - hide navbar
        setIsVisible(false);
      } else {
        // Scrolling up - show navbar
        setIsVisible(true);
      }
      lastScrollYRef.current = currentScrollY;
    };

    // Passive listener for better scroll performance
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [isMobile]);

  return isVisible;
}
