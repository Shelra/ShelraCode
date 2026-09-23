import type { CSSProperties } from "react";

/*
 * Vector icons of the site, with the exact path data Framer renders.
 * Every icon is a 24x24 viewBox; `color` is the stroke colour and
 * `strokeWidth` the stroke width, like the Framer icon controls.
 */
export type IconProps = {
  color?: string;
  strokeWidth?: number;
  size?: number;
  className?: string;
  style?: CSSProperties;
};

export type PathDef = { d: string; transform: string; fill?: boolean };

export function makeIcon(name: string, paths: PathDef[], defaultStroke = 2) {
  function Icon({ color = "rgb(0,0,0)", strokeWidth = defaultStroke, size = 24, className, style }: IconProps) {
    return (
      <svg
        role="presentation"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={className}
        style={{ display: "block", aspectRatio: "1", ...style }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <title>{name}</title>
        {paths.map((p) => (
          <path
            key={p.d + p.transform}
            d={p.d}
            transform={p.transform}
            fill={p.fill ? color : "transparent"}
            stroke={p.fill ? undefined : color}
            strokeWidth={p.fill ? undefined : strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    );
  }
  Icon.displayName = name;
  return Icon;
}

export const ArrowRightIcon = makeIcon("Arrow Right", [
  { d: "M 0 0 L 14 0", transform: "translate(5 12)" },
  { d: "M 0 0 L 7 7 L 0 14", transform: "translate(12 5)" },
]);

export const FeatherIcon = makeIcon("Feather", [
  {
    d: "M 7.67 16.813 C 8.201 16.813 8.711 16.601 9.086 16.225 L 15.24 10.053 C 17.584 7.709 17.584 3.907 15.24 1.563 C 12.896 -0.781 9.094 -0.781 6.75 1.563 L 0.586 7.727 C 0.211 8.102 0 8.611 0 9.141 L 0 15.813 C 0 16.365 0.448 16.813 1 16.813 Z",
    transform: "translate(5 2.187)",
  },
  { d: "M 14 0 L 0 14", transform: "translate(2 8)" },
  { d: "M 8.5 0 L 0 0", transform: "translate(9 15)" },
]);

export const EyeIcon = makeIcon("Eye", [
  {
    d: "M 0.063 7.347 C -0.021 7.123 -0.021 6.876 0.063 6.651 C 1.723 2.626 5.647 0 10.001 0 C 14.354 0 18.278 2.626 19.939 6.651 C 20.022 6.876 20.022 7.123 19.939 7.347 C 18.278 11.372 14.354 13.999 10.001 13.999 C 5.647 13.999 1.723 11.372 0.063 7.347",
    transform: "translate(1.999 5.001)",
  },
  {
    d: "M 0 3 C 0 1.343 1.343 0 3 0 C 4.657 0 6 1.343 6 3 C 6 4.657 4.657 6 3 6 C 1.343 6 0 4.657 0 3 Z",
    transform: "translate(9 9)",
  },
]);

export const HourglassIcon = makeIcon("Hourglass", [
  { d: "M 0 0 L 14 0", transform: "translate(5 22)" },
  { d: "M 0 0 L 14 0", transform: "translate(5 2)" },
  {
    d: "M 10 10 L 10 5.828 C 10 5.298 9.789 4.789 9.414 4.414 L 5 0 L 0.586 4.414 C 0.211 4.789 0 5.298 0 5.828 L 0 10",
    transform: "translate(7 12)",
  },
  {
    d: "M 0 0 L 0 4.172 C 0 4.702 0.211 5.211 0.586 5.586 L 5 10 L 9.414 5.586 C 9.789 5.211 10 4.702 10 4.172 L 10 0",
    transform: "translate(7 2)",
  },
]);

export const RocketIcon = makeIcon("Rocket", [
  {
    d: "M 2 0.513 C 0.5 1.773 0 5.513 0 5.513 C 0 5.513 3.74 5.013 5 3.513 C 5.71 2.673 5.7 1.383 4.91 0.603 C 4.105 -0.165 2.851 -0.204 2 0.513 Z",
    transform: "translate(2.5 15.987)",
  },
  {
    d: "M 3 13 L 0 10 C 0.532 8.62 1.202 7.296 2 6.05 C 4.369 2.262 8.532 -0.027 13 0 C 13 2.72 12.22 7.5 7 11 C 5.737 11.799 4.397 12.469 3 13 Z",
    transform: "translate(9 2)",
  },
  { d: "M 5 4.48 L 0 4.48 C 0 4.48 0.55 1.45 2 0.48 C 3.62 -0.6 7 0.48 7 0.48", transform: "translate(4 7.52)" },
  { d: "M 0 2 L 0 7 C 0 7 3.03 6.45 4 5 C 5.08 3.38 4 0 4 0", transform: "translate(12 13)" },
]);

export const ShieldIcon = makeIcon("Shield", [
  {
    d: "M 16 10.997 C 16 15.997 12.5 18.497 8.34 19.947 C 8.122 20.021 7.886 20.017 7.67 19.937 C 3.5 18.497 0 15.997 0 10.997 L 0 3.997 C 0 3.445 0.448 2.997 1 2.997 C 3 2.997 5.5 1.797 7.24 0.277 C 7.678 -0.097 8.322 -0.097 8.76 0.277 C 10.51 1.807 13 2.997 15 2.997 C 15.552 2.997 16 3.445 16 3.997 Z",
    transform: "translate(4 2.003)",
  },
]);

export const GitBranchIcon = makeIcon("Git Branch", [
  { d: "M 0 0 L 0 12", transform: "translate(6 3)" },
  {
    d: "M 0 3 C 0 1.343 1.343 0 3 0 C 4.657 0 6 1.343 6 3 C 6 4.657 4.657 6 3 6 C 1.343 6 0 4.657 0 3 Z",
    transform: "translate(15 3)",
  },
  {
    d: "M 0 3 C 0 1.343 1.343 0 3 0 C 4.657 0 6 1.343 6 3 C 6 4.657 4.657 6 3 6 C 1.343 6 0 4.657 0 3 Z",
    transform: "translate(3 15)",
  },
  { d: "M 9 0 C 9 4.971 4.971 9 0 9", transform: "translate(9 9)" },
]);

export const BlocksIcon = makeIcon("Blocks", [
  {
    d: "M 8 16 L 8 1 C 8 0.448 7.552 0 7 0 L 2 0 C 0.895 0 0 0.895 0 2 L 0 14 C 0 15.105 0.895 16 2 16 L 14 16 C 15.105 16 16 15.105 16 14 L 16 9 C 16 8.448 15.552 8 15 8 L 0 8",
    transform: "translate(2 6)",
  },
  {
    d: "M 1 8 C 0.448 8 0 7.552 0 7 L 0 1 C 0 0.448 0.448 0 1 0 L 7 0 C 7.552 0 8 0.448 8 1 L 8 7 C 8 7.552 7.552 8 7 8 Z",
    transform: "translate(14 2)",
  },
]);

export const BugIcon = makeIcon("Bug", [
  { d: "M 0 9 L 0 0", transform: "translate(12 11)" },
  {
    d: "M 8 0 C 10.209 0 12 1.791 12 4 L 12 7 C 12 10.314 9.314 13 6 13 C 2.686 13 0 10.314 0 7 L 0 4 C 0 1.791 1.791 0 4 0 Z",
    transform: "translate(6 7)",
  },
  { d: "M 0 1.88 L 1.88 0", transform: "translate(14.12 2)" },
  { d: "M 3.81 4 C 3.812 1.863 2.135 0.102 0 0", transform: "translate(17.19 17)" },
  { d: "M 3.55 0 C 3.548 2.033 2.02 3.741 0 3.97", transform: "translate(17.45 5)" },
  { d: "M 4 0 L 0 0", transform: "translate(18 13)" },
  { d: "M 0 4 C -0.002 1.863 1.675 0.102 3.81 0", transform: "translate(3 17)" },
  { d: "M 0 0 C 0.002 2.033 1.53 3.741 3.55 3.97", transform: "translate(3 5)" },
  { d: "M 4 0 L 0 0", transform: "translate(2 13)" },
  { d: "M 0 0 L 1.88 1.88", transform: "translate(8 2)" },
  { d: "M 0 4.13 L 0 3 C 0 1.343 1.343 0 3 0 C 4.657 0 6 1.343 6 3 L 6 4.13", transform: "translate(9 3)" },
]);

export const FlaskConicalIcon = makeIcon("Flask Conical", [
  {
    d: "M 10 0 L 10 6 C 10 6.335 10.085 6.666 10.245 6.96 L 15.755 17.04 C 16.095 17.66 16.082 18.412 15.721 19.02 C 15.361 19.628 14.707 20 14 20 L 2 20 C 1.294 20 0.64 19.628 0.28 19.02 C -0.081 18.412 -0.094 17.66 0.245 17.04 L 5.755 6.96 C 5.916 6.666 6.001 6.335 6 6 L 6 0",
    transform: "translate(4 2)",
  },
  { d: "M 0 0 L 11.094 0", transform: "translate(6.453 15)" },
  { d: "M 0 0 L 7 0", transform: "translate(8.5 2)" },
]);

export const CheckIcon = makeIcon("Check", [{ d: "M 16 0 L 5 11 L 0 6", transform: "translate(4 6)" }]);

export const ZapIcon = makeIcon("Zap", [
  {
    d: "M 1.003 12.003 C 0.617 12.004 0.265 11.783 0.098 11.434 C -0.069 11.086 -0.02 10.673 0.223 10.373 L 10.123 0.173 C 10.276 -0.004 10.531 -0.051 10.737 0.059 C 10.943 0.169 11.045 0.407 10.983 0.633 L 9.063 6.653 C 8.948 6.96 8.992 7.305 9.18 7.574 C 9.367 7.844 9.675 8.004 10.003 8.003 L 17.003 8.003 C 17.39 8.001 17.742 8.223 17.909 8.571 C 18.076 8.919 18.027 9.333 17.783 9.633 L 7.883 19.833 C 7.73 20.009 7.476 20.056 7.27 19.946 C 7.064 19.836 6.961 19.598 7.023 19.373 L 8.943 13.353 C 9.058 13.045 9.015 12.701 8.827 12.431 C 8.64 12.162 8.332 12.002 8.003 12.003 Z",
    transform: "translate(2.997 1.997)",
  },
]);

export const MenuIcon = makeIcon("Menu", [
  { d: "M 0 0 L 16 0", transform: "translate(4 5)" },
  { d: "M 0 0 L 16 0", transform: "translate(4 12)" },
  { d: "M 0 0 L 16 0", transform: "translate(4 19)" },
]);

export const XIcon = makeIcon("X", [
  { d: "M 12 0 L 0 12", transform: "translate(6 6)" },
  { d: "M 0 0 L 12 12", transform: "translate(6 6)" },
]);

/* Logo-style icons: an (invisible) filled shape plus 1.5px strokes. */
export const PlusIcon = makeIcon(
  "Plus",
  [
    { d: "M 0 0 L 16.5 0", transform: "translate(3.75 12)" },
    { d: "M 0 0 L 0 16.5", transform: "translate(12 3.75)" },
  ],
  1.5,
);

export const LinkedinLogoIcon = makeIcon(
  "Linkedin Logo",
  [
    {
      d: "M 0.75 18 C 0.336 18 0 17.664 0 17.25 L 0 0.75 C 0 0.336 0.336 0 0.75 0 L 17.25 0 C 17.664 0 18 0.336 18 0.75 L 18 17.25 C 18 17.664 17.664 18 17.25 18 Z",
      transform: "translate(3 3)",
    },
    { d: "M 0 0 L 0 6", transform: "translate(11.25 10.5)" },
    { d: "M 0 0 L 0 6", transform: "translate(8.25 10.5)" },
    {
      d: "M 0 2.625 C 0 1.175 1.175 0 2.625 0 C 4.075 0 5.25 1.175 5.25 2.625 L 5.25 6",
      transform: "translate(11.25 10.5)",
    },
    {
      d: "M 0 1.125 C 0 0.504 0.504 0 1.125 0 C 1.746 0 2.25 0.504 2.25 1.125 C 2.25 1.746 1.746 2.25 1.125 2.25 C 0.504 2.25 0 1.746 0 1.125 Z",
      transform: "translate(7.125 6.75)",
      fill: true,
    },
  ],
  1.5,
);

export const XLogoIcon = makeIcon(
  "X Logo",
  [
    { d: "M 0 0 L 4.5 0 L 15 16.5 L 10.5 16.5 Z", transform: "translate(4.5 3.75)" },
    { d: "M 6.176 0 L 0 6.794", transform: "translate(4.5 13.456)" },
    { d: "M 6.176 0 L 0 6.794", transform: "translate(13.324 3.75)" },
  ],
  1.5,
);

/* Google's "G", single colour so it sits in the palette like the other logo icons. */
export const GoogleLogoIcon = makeIcon("Google Logo", [
  {
    d: "M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z",
    transform: "translate(3 3) scale(0.75)",
    fill: true,
  },
]);

export const GithubLogoIcon = makeIcon(
  "Github Logo",
  [
    {
      d: "M 5.234 2.25 C 4.338 0.848 2.789 0 1.125 0 C 0.387 1.275 0.267 2.816 0.798 4.191 C 0.285 4.946 0.007 5.837 0 6.75 L 0 7.5 C 0 9.985 2.015 12 4.5 12 L 9 12 C 11.485 12 13.5 9.985 13.5 7.5 L 13.5 6.75 C 13.493 5.837 13.215 4.946 12.702 4.191 C 13.233 2.816 13.113 1.275 12.375 0 C 10.711 0 9.162 0.848 8.266 2.25 Z",
      transform: "translate(6 3)",
    },
    { d: "M 0 6.75 L 0 3 C 0 1.343 1.343 0 3 0 L 3 0 C 4.657 0 6 1.343 6 3 L 6 6.75", transform: "translate(9.75 15)" },
    { d: "M 9 6 L 6 6 C 4.343 6 3 4.657 3 3 C 3 1.343 1.657 0 0 0", transform: "translate(0.75 13.5)" },
  ],
  1.5,
);
