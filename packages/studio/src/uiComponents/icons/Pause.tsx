import * as React from 'react'

function Pause(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4.5 3h2.5v10H4.5v-10zm4.5 0h2.5v10H9V3z"
        fill="currentColor"
      />
    </svg>
  )
}

export default Pause
