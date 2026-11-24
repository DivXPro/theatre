import {usePrism} from '@dreamerbird/react'
import {val} from '@dreamerbird/dataverse'
import React, {useState} from 'react'
import styled from 'styled-components'
import type Sheet from '@dreamerbird/core/sheets/Sheet'
import getStudio from '@dreamerbird/studio/getStudio'
import ChevronDown from '@dreamerbird/studio/uiComponents/icons/ChevronDown'
import DoubleChevronLeft from '@dreamerbird/studio/uiComponents/icons/DoubleChevronLeft'
import DoubleChevronRight from '@dreamerbird/studio/uiComponents/icons/DoubleChevronRight'
import Play from '@dreamerbird/studio/uiComponents/icons/Play'
import Pause from '@dreamerbird/studio/uiComponents/icons/Pause'
import {useT} from '@dreamerbird/studio/i18n'

/** 工具条行高:比原 18px 标题栏高一点,容得下按钮;配色/字号沿用 TitleBar */
export const transportBarHeight = 36

const Bar = styled.div`
  height: ${transportBarHeight}px;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  color: var(--theatre-text-secondary);
  border-bottom: 1px solid var(--theatre-panel-border);
  border-radius: var(--theatre-panel-radius) var(--theatre-panel-radius) 0 0;
  background-color: var(--theatre-panel-bg-95);
  font-size: 11px;
  font-weight: 500;
  overflow: hidden;
  white-space: nowrap;
`

const ButtonGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const TransportButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  cursor: pointer;

  svg {
    width: 12px;
    height: 12px;
  }

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }

  &:disabled {
    opacity: 0.35;
    cursor: default;
  }
`

const TimeReadout = styled.span`
  justify-self: end;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`

const Fps = styled.span`
  margin-left: 8px;
  padding-left: 8px;
  border-left: 1px solid var(--theatre-panel-border);
  color: var(--theatre-text-muted);
`

/** 总时长(只读态):提示可点 */
const LengthValue = styled.span`
  cursor: text;
  border-radius: 3px;
  padding: 1px 3px;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }
`

/** 总时长编辑框:和读数同字号,避免切换时跳动 */
const LengthInput = styled.input`
  width: 52px;
  padding: 1px 3px;
  border: 1px solid #4a4d52;
  border-radius: 3px;
  background: #1a1c1f;
  color: #fff;
  font-size: 10px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  outline: none;
`

/**
 * 时间轴顶部的操作条:收拢/展开 + 播放控制(回开头、播放/暂停、时间)。
 * 收拢模式下它自己就是整个停靠条;展开模式下它是面板的第一行。
 * 播放作用于当前选中的序列(和空格键同一对象),没选中时按钮置灰。
 * 时间读数斜杠后的总时长可点击编辑(秒),回车/失焦确认,Esc 取消——
 * 提交走 core 的 setLength 事务,与时间轴右缘的时长拖拽手柄同路径。
 */
const TransportBar: React.FC<{
  sheet: Sheet | undefined
  collapsed: boolean
  onToggle: () => void
}> = ({sheet, collapsed, onToggle}) => {
  const t = useT()
  const [editingLength, setEditingLength] = useState(false)
  const [draft, setDraft] = useState('')

  const {playing, positionText, lengthText, lengthSec, hasSeq, fps} =
    usePrism(() => {
      const seq = sheet?.getSequence()
      if (!seq)
        return {
          playing: false,
          positionText: '',
          lengthText: '',
          lengthSec: 0,
          hasSeq: false,
          fps: 0,
        }
      const fmt = seq.positionFormatter
      const lengthSec = val(seq.pointer.length)
      return {
        playing: seq.playing,
        positionText: fmt.formatForPlayhead(val(seq.pointer.position)),
        lengthText: fmt.formatBasic(lengthSec),
        lengthSec,
        hasSeq: true,
        fps: seq.subUnitsPerUnit,
      }
    }, [sheet])

  const togglePlay = () => {
    const seq = sheet?.getSequence()
    if (!seq) return
    // 内部 play() 要显式传 ticker,公开 API 自己取 core ticker
    if (seq.playing) {
      seq.publicApi.pause()
    } else {
      void seq.publicApi.play()
    }
  }
  const goToStart = () => {
    const seq = sheet?.getSequence()
    if (seq) seq.position = 0
  }
  const goToEnd = () => {
    const seq = sheet?.getSequence()
    if (seq) seq.position = seq.length
  }

  /** 提交时长编辑;非法/无变化直接还原,不产生事务 */
  const commitLength = () => {
    setEditingLength(false)
    if (!sheet) return
    const parsed = parseFloat(draft.trim().replace(/s$/i, ''))
    if (!Number.isFinite(parsed) || parsed <= 0) return
    const length = Math.round(parsed * 100) / 100
    if (Math.abs(length - lengthSec) < 1e-9) return
    getStudio().transaction(({stateEditors}) => {
      stateEditors.coreByProject.historic.sheetsById.sequence.setLength({
        ...sheet.address,
        length,
      })
    })
  }

  return (
    <Bar>
      <ButtonGroup>
        <TransportButton
          onClick={onToggle}
          title={collapsed ? '展开时间轴' : '收拢时间轴'}
        >
          <ChevronDown
            style={collapsed ? {transform: 'rotate(180deg)'} : undefined}
          />
        </TransportButton>
        <span>{t('workspace.timeline')}</span>
      </ButtonGroup>
      <ButtonGroup>
        <TransportButton
          onClick={goToStart}
          disabled={!hasSeq}
          title="回到开头"
        >
          <DoubleChevronLeft />
        </TransportButton>
        <TransportButton
          onClick={togglePlay}
          disabled={!hasSeq}
          title={playing ? '暂停' : '播放'}
        >
          {playing ? <Pause /> : <Play />}
        </TransportButton>
        <TransportButton
          onClick={goToEnd}
          disabled={!hasSeq}
          title={t('workspace.goToEnd')}
        >
          <DoubleChevronRight />
        </TransportButton>
      </ButtonGroup>
      <TimeReadout>
        {positionText}
        {' / '}
        {editingLength ? (
          <LengthInput
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitLength}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitLength()
              else if (e.key === 'Escape') setEditingLength(false)
            }}
            onFocus={(e) => e.target.select()}
          />
        ) : (
          <LengthValue
            title="点击修改播放时长(秒)"
            onClick={() => {
              if (!hasSeq) return
              setDraft(lengthSec.toFixed(2))
              setEditingLength(true)
            }}
          >
            {lengthText}
          </LengthValue>
        )}
        {hasSeq && <Fps>{fps} fps</Fps>}
      </TimeReadout>
    </Bar>
  )
}

export default TransportBar
