import "!!style-loader!css-loader!./sortable.css";
import { action, makeObservable } from "mobx";
import { observer } from "mobx-react";
import { Component } from "react";
import Sortable from "react-anything-sortable";
import styled from "styled-components";
import Terria from "../../Models/Terria";
import ViewState from "../../ReactViewModels/ViewState";
import { Ul } from "../../Styled/List";
import WorkbenchItem from "./WorkbenchItem";
import WorkbenchSplitScreen from "./WorkbenchSplitScreen";

const StyledUl = styled(Ul)`
  gap: 5px;
  margin: 15px 0;
  padding: 0 15px;
  li {
    &:first-child {
      margin-top: 0;
    }
  }
`;

interface IProps {
  terria: Terria;
  viewState: ViewState;
}

@observer
class WorkbenchList extends Component<IProps> {
  constructor(props: IProps) {
    super(props);
    makeObservable(this);
  }

  @action.bound
  onSort(
    _sortedArray: any,
    currentDraggingSortData: any,
    currentDraggingIndex: any
  ) {
    // The Sortable renders only the VISIBLE items (hideInWorkbench filtered
    // out below), so its drag index is an index into the visible list. The
    // workbench array still contains the hidden items, so translate the drop
    // position to a full-array index via the visible item currently occupying
    // that slot — otherwise a hidden linked item sitting between visible rows
    // skews every drop below it.
    const items = this.props.terria.workbench.items;
    const visible = items.filter(
      (i) => (i as any).hideInWorkbench !== true
    );
    const target = visible[currentDraggingIndex];
    const realIndex =
      target !== undefined ? items.indexOf(target) : currentDraggingIndex;
    this.props.terria.workbench.moveItemToIndex(
      currentDraggingSortData,
      realIndex
    );
  }

  render() {
    return (
      <StyledUl
        overflowY="auto"
        overflowX="hidden"
        scroll
        fullWidth
        column
        flex="1"
      >
        {this.props.terria.showSplitter && (
          <WorkbenchSplitScreen terria={this.props.terria} />
        )}
        <Sortable
          onSort={this.onSort}
          direction="vertical"
          dynamic
          css={`
            width: 100%;
          `}
        >
          {this.props.terria.workbench.items
            .filter((item) => (item as any).hideInWorkbench !== true)
            .map((item) => {
              return (
                <WorkbenchItem
                  item={item}
                  sortData={item}
                  key={item.uniqueId}
                  viewState={this.props.viewState}
                />
              );
            })}
        </Sortable>
      </StyledUl>
    );
  }
}

export default WorkbenchList;
