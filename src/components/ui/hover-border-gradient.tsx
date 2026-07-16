import React, { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "../../utils/cn";

const gradients = {
  TOP: "radial-gradient(20.7% 50% at 50% 0%, rgba(255,100,150,0.7) 0%, rgba(255,255,255,0) 100%)",
  RIGHT: "radial-gradient(16.2% 41.2% at 100% 50%, rgba(100,255,200,0.7) 0%, rgba(255,255,255,0) 100%)",
  BOTTOM: "radial-gradient(20.7% 50% at 50% 100%, rgba(255,200,100,0.7) 0%, rgba(255,255,255,0) 100%)",
  LEFT: "radial-gradient(16.6% 43.1% at 0% 50%, rgba(100,150,255,0.7) 0%, rgba(255,255,255,0) 100%)",
};

const loop = [gradients.TOP, gradients.RIGHT, gradients.BOTTOM, gradients.LEFT, gradients.TOP];

const highlight =
  "radial-gradient(75% 181.16% at 50% 50%, rgba(255,100,150,0.5) 0%, rgba(100,150,255,0.4) 25%, rgba(255,200,100,0.3) 50%, rgba(100,255,200,0.25) 75%, rgba(52,211,153,0.15) 100%)";

/** Muted ambient — slate / cool neutral, aligned with sf panel chrome */
const highlightSubtle =
  "radial-gradient(75% 181.16% at 50% 50%, rgba(148,163,184,0.16) 0%, rgba(99,102,241,0.07) 38%, rgba(148,163,184,0.06) 65%, transparent 100%)";

const cornerGlow = [
  "radial-gradient(circle at 0% 0%, rgba(255,100,150,0.35) 0%, transparent 60%)",
  "radial-gradient(circle at 100% 0%, rgba(100,255,200,0.35) 0%, transparent 60%)",
  "radial-gradient(circle at 100% 100%, rgba(255,200,100,0.35) 0%, transparent 60%)",
  "radial-gradient(circle at 0% 100%, rgba(100,150,255,0.35) 0%, transparent 60%)",
].join(", ");

const cornerGlowSubtle = [
  "radial-gradient(circle at 0% 0%, rgba(148,163,184,0.14) 0%, transparent 58%)",
  "radial-gradient(circle at 100% 0%, rgba(99,102,241,0.1) 0%, transparent 58%)",
  "radial-gradient(circle at 100% 100%, rgba(148,163,184,0.12) 0%, transparent 58%)",
  "radial-gradient(circle at 0% 100%, rgba(99,102,241,0.08) 0%, transparent 58%)",
].join(", ");

const gradientsSubtle = {
  TOP: "radial-gradient(20.7% 50% at 50% 0%, rgba(148,163,184,0.22) 0%, rgba(255,255,255,0) 100%)",
  RIGHT: "radial-gradient(16.2% 41.2% at 100% 50%, rgba(99,102,241,0.14) 0%, rgba(255,255,255,0) 100%)",
  BOTTOM: "radial-gradient(20.7% 50% at 50% 100%, rgba(148,163,184,0.18) 0%, rgba(255,255,255,0) 100%)",
  LEFT: "radial-gradient(16.6% 43.1% at 0% 50%, rgba(99,102,241,0.12) 0%, rgba(255,255,255,0) 100%)",
};

const loopSubtle = [
  gradientsSubtle.TOP,
  gradientsSubtle.RIGHT,
  gradientsSubtle.BOTTOM,
  gradientsSubtle.LEFT,
  gradientsSubtle.TOP,
];

interface HoverBorderGradientProps extends React.HTMLAttributes<HTMLElement> {
  as?: React.ElementType;
  containerClassName?: string;
  className?: string;
  fillClassName?: string;
  duration?: number;
  /** subtle = low-saturation slate/indigo halo (dense modals); default = full rainbow ambient */
  variant?: "default" | "subtle";
  children: React.ReactNode;
}

export const HoverBorderGradient: React.FC<HoverBorderGradientProps> = ({
  as: Tag = "div",
  containerClassName,
  className,
  fillClassName,
  duration = 3,
  variant = "default",
  children,
  ...props
}) => {
  const [hovered, setHovered] = useState(false);
  const Outer = Tag as any;

  const hl = variant === "subtle" ? highlightSubtle : highlight;
  const corners = variant === "subtle" ? cornerGlowSubtle : cornerGlow;
  const animLoop = variant === "subtle" ? loopSubtle : loop;

  return (
    <Outer
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "relative flex rounded-xl content-center p-[2px] transition duration-500 items-center flex-col flex-nowrap gap-0 justify-center overflow-visible decoration-clone",
        containerClassName
      )}
      {...props}
    >
      <div className={cn("w-full z-[2] rounded-[inherit]", className)}>
        {children}
      </div>
      <div
        className="flex-none inset-0 overflow-hidden absolute z-0 rounded-[inherit]"
        style={{ background: corners }}
      />
      <motion.div
        className="flex-none inset-0 overflow-hidden absolute z-0 rounded-[inherit]"
        animate={{
          background: hovered ? [hl, hl] : animLoop,
        }}
        transition={{
          duration: hovered ? 0.5 : duration * 4,
          ease: "linear",
          repeat: Infinity,
        }}
      />
      <div className={cn("absolute z-[1] flex-none inset-[2px] rounded-[inherit] bg-[var(--sf-bg-panel)]", fillClassName)} />
    </Outer>
  );
};
