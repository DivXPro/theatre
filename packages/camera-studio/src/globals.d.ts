// The explicit URL query lets Vite process the demo model without assetsInclude.
declare module '*.glb?url' {
  export default string
}
