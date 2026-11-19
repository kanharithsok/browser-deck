export type AppMenuIcon =
  | 'add'
  | 'responsive'
  | 'fit'
  | 'reset'
  | 'hand'
  | 'phone'
  | 'tablet'
  | 'desktop'
  | 'profiles'
  | 'workspaces'
  | 'system'
  | 'sun'
  | 'moon'
  | 'back'
  | 'forward'
  | 'copy'
  | 'rotate'
  | 'camera'
  | 'duplicate'
  | 'rename'
  | 'devtools'
  | 'close'

export interface AppMenuItem {
  id: string
  label: string
  icon?: AppMenuIcon
  detail?: string
  disabled?: boolean
  checked?: boolean
  separatorBefore?: boolean
  kind?: 'item' | 'checkbox' | 'radio'
}

export interface AppMenuSection {
  label?: string
  items: AppMenuItem[]
}

export interface AppMenuModel {
  label: string
  sections: AppMenuSection[]
}
