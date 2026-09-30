import * as React from 'react'

function Play(props: React.SVGProps<SVGSVGElement>) {
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
        d="M4.5 2.7v10.6c0 .4.5.7.8.4l8-5.3c.3-.2.3-.6 0-.8l-8-5.3c-.3-.3-.8 0-.8.4z"
        fill="currentColor"
      />
    </svg>
  )
}

export default Play
