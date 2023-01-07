
//"SPDX-License-Identifier: BUSL1.1"
pragma solidity ^0.7.0;
pragma experimental ABIEncoderV2;



contract Heap {
    struct Node {
        uint value;
        uint index;
    }

    Node[] nodes;
    uint[] indices;




    function peek() public view returns (uint) {
        return nodes[0].value;
    }

    function push(uint value) public {
        uint index = nodes.length;
        nodes.push(Node(value, index));
        indices.push(index);
        siftUp(index);
    }

    function pop() public returns (uint) {
        uint poppedValue = nodes[0].value;
        uint lastIndex = nodes.length - 1;
        nodes[0] = nodes[lastIndex];
        nodes[0].index = 0;
        indices[nodes[0].index] = 0;
        delete nodes[lastIndex];
        delete indices[indices.length - 1];
        siftDown(0);
        return poppedValue;
    }

    function siftUp(uint index) internal {
        uint parentIndex;
        if (index != 0) {
            parentIndex = (index - 1) / 2;
            if (nodes[parentIndex].value > nodes[index].value) {
                swap(parentIndex, index);
                siftUp(parentIndex);
            }
        }
    }

    function siftDown(uint index) internal {
        uint leftChildIndex = 2 * index + 1;
        uint rightChildIndex = 2 * index + 2;
        uint smallestIndex = index;
        if (leftChildIndex < nodes.length && nodes[leftChildIndex].value < nodes[smallestIndex].value) {
            smallestIndex = leftChildIndex;
        }
        if (rightChildIndex < nodes.length && nodes[rightChildIndex].value < nodes[smallestIndex].value) {
            smallestIndex = rightChildIndex;
        }
        if (smallestIndex != index) {
            swap(smallestIndex, index);
            siftDown(smallestIndex);
        }
    }

    function swap(uint a, uint b) internal {
        Node memory temp = nodes[a];
        nodes[a] = nodes[b];
        nodes[b] = temp;
        indices[nodes[a].index] = a;
        indices[nodes[b].index] = b;
        Node storage nodeA = nodes[a];
        nodeA.index = a;
        Node storage nodeB = nodes[b];
        nodeB.index = b;
    }

    function getNodes() public view returns (Node[] memory) {
        return nodes;
    }






}
