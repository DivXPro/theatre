import {css} from 'styled-components'

export const compactCameraWorkspace = '(max-width: 1160px)'

export const cameraWorkspaceLayout = css`
  --theatre-camera-panel-inset: 12px;
  --theatre-camera-project-row-height: 44px;
  --theatre-camera-sidebar-width: clamp(142px, 28vw, 236px);
  --theatre-camera-inspector-width: 306px;
  --theatre-camera-tool-size: 34px;
  --theatre-camera-tool-tray-padding: 4px;
  --theatre-camera-panel-top: calc(
    var(--theatre-camera-top, 0px) + var(--theatre-camera-panel-inset)
  );

  @media ${compactCameraWorkspace} {
    --theatre-camera-panel-top: calc(
      var(--theatre-camera-top, 0px) + var(--theatre-camera-panel-inset) +
        var(--theatre-camera-tool-size) + 2 *
        var(--theatre-camera-tool-tray-padding) + 10px
    );
  }
`
