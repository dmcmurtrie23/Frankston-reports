import React, { createContext, useContext } from 'react'
import { BASE_URL } from './api.js'

// Saved player photos ({player name: url path}), shared with every tab.
export const PhotoContext = createContext({})

export function Avatar({ name, size = 36, className = '' }) {
  const photos = useContext(PhotoContext)
  const path = photos?.[name]
  if (!path) return null
  return <img className={`player-avatar ${className}`} src={`${BASE_URL}${path}`} alt={name} width={size} height={size} />
}
