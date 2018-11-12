var Artifact = (function() {
  Artifact.version = 2;
  Artifact.encodedPrefix = "ADC";
  Artifact.sm_nMaxBytesForVarUint32 = 5;
  Artifact.knHeaderSize = 3;
  function Artifact() {}
  Artifact.prototype.parseDeck = function(deckStr) {
    let deckBytes = this.decodeDeckString(deckStr);
    if (!deckBytes) {
      return false;
    }
    let deck = this.parseDeckInternal(deckStr, deckBytes);
    return deck;
  };

  Artifact.prototype.rawDeckBytes = function(deckStr) {
    let deckBytes = this.decodeDeckString(deckStr);
    return deckBytes;
  };

  Artifact.prototype.decodeDeckString = function(deckStr) {
    if (
      deckStr.substring(0, Artifact.encodedPrefix.length) !==
      Artifact.encodedPrefix
    ) {
      return false;
    }

    let deckStrWithoutPrefix = deckStr.substr(Artifact.encodedPrefix.length);
    let resultStr = deckStrWithoutPrefix.replace(/-/g, "/");
    resultStr = deckStrWithoutPrefix.replace(/_/g, "=");
    decode = atob(resultStr);
    let decodeByte = [];
    for (var i = 0; i < decode.length; i++) {
      decodeByte.push(decode.charCodeAt(i));
    }
    return decodeByte;
  };

  Artifact.prototype.readBitsChunk = function(
    nChunk,
    nNumBits,
    nCurrShift,
    nOutBits
  ) {
    var nContinueBit = 1 << nNumBits;
    var nNewBits = nChunk & (nContinueBit - 1);
    var nOutBitsValue = nOutBits | (nNewBits << nCurrShift);
    return [nOutBitsValue, (nChunk & nContinueBit) != 0];
  };

  Artifact.prototype.readVarEncodedUint32 = function(
    nBaseValue,
    nBaseBits,
    data,
    indexStart,
    indexEnd
  ) {
    var nDeltaShift = 0;
    var index = indexStart;
    let outValueResult = 0;
    let [outValueResult1, readBitsChunkResult] = this.readBitsChunk(
      nBaseValue,
      nBaseBits,
      nDeltaShift,
      outValueResult
    );
    outValueResult = outValueResult1;
    if (nBaseBits === 0 || readBitsChunkResult) {
      nDeltaShift += nBaseBits;
      while (1) {
        if (indexStart > indexEnd) {
          return [index, outValueResult, false];
        }
        var nNextBits = data[index++];
        let [outValueResult2, readBitsChunkResult1] = this.readBitsChunk(
          nNextBits,
          7,
          nDeltaShift,
          outValueResult
        );
        outValueResult = outValueResult2;
        if (!readBitsChunkResult1) {
          break;
        }
        nDeltaShift += 7;
      }
    }
    return [index, outValueResult, true];
  };

  Artifact.prototype.readSerializedCard = function(
    data,
    indexStart,
    indexEnd,
    nPrevCardBase,
    nOutCount,
    nOutCardID
  ) {
    if (indexStart > indexEnd) {
      return false;
    }
    let _indexStart = indexStart;
    let _nPrevCardBase = nPrevCardBase;
    let _nOutCount = nOutCount;
    let _nOutCardId = nOutCardID;
    const nHeader = data[_indexStart++];
    const bHasExtendedCount = nHeader >> 6 === 0x03;
    let nCardDelta = 0;
    const [_indexStart1, outValueResult, result] = this.readVarEncodedUint32(
      nHeader,
      5,
      data,
      _indexStart,
      indexEnd
    );
    _indexStart = _indexStart1;
    nCardDelta = outValueResult;
    if (!result) {
      return [_indexStart, _nPrevCardBase, _nOutCount, _nOutCardId, false];
    }
    _nOutCardId = _nPrevCardBase + nCardDelta;

    if (bHasExtendedCount) {
      const [index, outValueResult, readVarResult] = this.readVarEncodedUint32(
        0,
        0,
        data,
        _indexStart,
        indexEnd
      );
      _indexStart = index;
      _nOutCount = outValueResult;
      if (!readVarResult) {
        return [_indexStart, _nPrevCardBase, _nOutCount, _nOutCardId, false];
      }
    } else {
      _nOutCount = (nHeader >> 6) + 1;
    }
    _nPrevCardBase = _nOutCardId;

    return [_indexStart, _nPrevCardBase, _nOutCount, _nOutCardId, true];
  };

  Artifact.prototype.parseDeckInternal = function(strDeckCode, deckBytes) {
    let nCurrentByteIndex = 0;
    const nTotalBytes = deckBytes.length;
    const nVersionAndHeroes = deckBytes[nCurrentByteIndex++];
    const version = nVersionAndHeroes >> 4;
    if (Artifact.version != version && version !== 1) {
      return false;
    }

    const nChecksum = deckBytes[nCurrentByteIndex++];
    let nStringLength = 0;
    if (version > 1) {
      nStringLength = deckBytes[nCurrentByteIndex++];
    }
    const nTotalCardBytes = nTotalBytes - nStringLength;
    {
      let nComputedChecksum = 0;
      for (let i = nCurrentByteIndex; i < nTotalCardBytes; i++) {
        nComputedChecksum += deckBytes[i];
      }
      const masked = nComputedChecksum & 0xff;
      if (nChecksum !== masked) {
        return false;
      }
      let nNumHeroes = 0;
      const [index, outValueResult, readVarResult] = this.readVarEncodedUint32(
        nVersionAndHeroes,
        3,
        deckBytes,
        nCurrentByteIndex,
        nTotalCardBytes
      );
      nCurrentByteIndex = index;
      nNumHeroes = outValueResult;
      if (!readVarResult) {
        return false;
      }
      let heroes = [];
      {
        nPrevCardBase = 0;
        for (let currHero = 0; currHero < nNumHeroes; currHero++) {
          let nHeroTurn = 0;
          let nHeroCardId = 0;
          const [
            _indexStart,
            _nPrevCardBase,
            _nOutCount,
            _nOutCardId,
            readSerializedCardResult
          ] = this.readSerializedCard(
            deckBytes,
            nCurrentByteIndex,
            nTotalCardBytes,
            nPrevCardBase,
            nHeroTurn,
            nHeroCardId
          );
          nCurrentByteIndex = _indexStart;
          nPrevCardBase = _nPrevCardBase;
          nHeroTurn = _nOutCount;
          nHeroCardId = _nOutCardId;
          if (!readSerializedCardResult) {
            return false;
          }
          heroes.push({
            id: nHeroCardId,
            turn: nHeroTurn
          });
        }
      }
      let cards = [];
      {
        nPrevCardBase = 0;
        while (nCurrentByteIndex <= nTotalCardBytes - 1) {
          let nCardCount = 0;
          let nCardID = 0;
          const [
            _indexStart,
            _nPrevCardBase,
            _nOutCount,
            _nOutCardId,
            readSerializedCardResult
          ] = this.readSerializedCard(
            deckBytes,
            nCurrentByteIndex,
            nTotalBytes,
            nPrevCardBase,
            nCardCount,
            nCardID
          );
          nCurrentByteIndex = _indexStart;
          nPrevCardBase = _nPrevCardBase;
          nCardCount = _nOutCount;
          nCardID = _nOutCardId;
          if (!readSerializedCardResult) {
            return false;
          }
          cards.push({
            id: nCardID,
            count: nCardCount
          });
        }
      }
      let name = "";
      if (nCurrentByteIndex <= nTotalBytes) {
        name = deckBytes
          .slice(-1 * nStringLength)
          .map(c => String.fromCharCode(c))
          .join("");
      }
      return {
        heroes: heroes,
        cards: cards,
        name: name
      };
    }
  };

  Artifact.prototype.encodeDeck = function(deckContents) {
    if (!deckContents) {
      return false;
    }
    const bytes = this.encodeBytes(deckContents);
    if (!bytes) {
      return false;
    }
    const deckCode = this.encodeBytesToString(bytes);
    return deckCode;
  };

  Artifact.prototype.encodeBytes = function(_deckContents) {
    let deckContents = _deckContents;
    if (
      deckContents != undefined &&
      deckContents.heroes != undefined &&
      deckContents.cards != undefined
    ) {
      deckContents.cards.sort((a, b) => (a.id <= b.id ? -1 : 1));
      deckContents.heroes.sort((a, b) => (a.id <= b.id ? -1 : 1));
      const countHeroes = deckContents.heroes.length;
      const allCards = deckContents.heroes.concat(deckContents.cards);
      let bytes = [];
      const version =
        (Artifact.version << 4) | this.extractNBitsWithCarry(countHeroes, 3);
      let [_bytes, addBytesResult] = this.addBytes(bytes, version);
      bytes = _bytes;
      if (!addBytesResult) {
        return false;
      }

      const nDummyChecksum = 0;
      const nChecksumByte = bytes.length;

      let [_bytes1, addBytesResult1] = this.addBytes(bytes, nDummyChecksum);
      bytes = _bytes1;
      if (!addBytesResult1) {
        return false;
      }

      let nameLen = 0;
      if (deckContents.name != undefined) {
        let name = deckContents.name;
        while (name.length > 63) {
          let amountToTrim = Math.floor(name.length / 4);
          amountToTrim = amountToTrim > 1 ? amountToTrim : 1;
          name = name.substring(0, name.length - amountToTrim);
        }
        nameLen = name.length;
      }
      let [_bytes2, addBytesResult2] = this.addBytes(bytes, nameLen);
      bytes = _bytes2;
      if (!addBytesResult2) {
        return false;
      }

      let [
        _bytes3,
        addRemainingNumberToBufferResult
      ] = this.addRemainingNumberToBuffer(countHeroes, 3, bytes);
      bytes = _bytes;
      if (!addRemainingNumberToBufferResult) {
        return false;
      }

      let prevCardId = 0;
      for (let unCurrHero = 0; unCurrHero < countHeroes; unCurrHero++) {
        const card = allCards[unCurrHero];
        if (card.turn === 0) {
          return false;
        }
        let [_bytes3, addCardToBufferResult] = this.addCardToBuffer(
          card.turn,
          card.id - prevCardId,
          bytes
        );
        bytes = _bytes3;
        if (!addCardToBufferResult) {
          return false;
        }
        prevCardId = card.id;
      }
      prevCardId = 0;
      for (
        let nCurrCard = countHeroes;
        nCurrCard < allCards.length;
        nCurrCard++
      ) {
        const card = allCards[nCurrCard];
        if (card.count === 0) {
          return false;
        }
        if (card.id <= 0) {
          return false;
        }

        let [_bytes4, addCardToBufferResult1] = this.addCardToBuffer(
          card.count,
          card.id - prevCardId,
          bytes
        );
        bytes = _bytes4;
        if (!addCardToBufferResult1) {
          return false;
        }
        prevCardId = card.id;
      }
      const preStringByteCount = bytes.length;
      const nameBytes = deckContents.name.split("").map(c => c.charCodeAt(0));
      nameBytes.forEach(nameByte => {
        let [_bytes5, addBytesResult3] = this.addBytes(bytes, nameByte);
        bytes = _bytes5;
        if (!addBytesResult3) {
          return false;
        }
      });

      let [_bytes6, unFullChecksum] = this.computeChecksum(
        bytes,
        preStringByteCount - Artifact.knHeaderSize
      );
      bytes = _bytes6;
      const unSmallChecksum = unFullChecksum & 0x0ff;

      bytes[nChecksumByte] = unSmallChecksum;
      return bytes;
    }
  };

  Artifact.prototype.extractNBitsWithCarry = function(value, numBits) {
    const unLimitBit = 1 << numBits;
    let unResult = value & (unLimitBit - 1);
    if (value >= unLimitBit) {
      unResult |= unLimitBit;
    }
    return unResult;
  };

  Artifact.prototype.addBytes = function(_bytes, byte) {
    let bytes = _bytes;
    if (byte > 255) {
      return [bytes, false];
    }
    bytes.push(byte);
    return [bytes, true];
  };

  Artifact.prototype.addRemainingNumberToBuffer = function(
    unValue,
    unAlreadyWrittenBits,
    _bytes
  ) {
    let bytes = _bytes;
    unValue >>= unAlreadyWrittenBits;
    while (unValue > 0) {
      unNextByte = this.extractNBitsWithCarry(unValue, 7);
      unValue >>= 7;
      let [_bytes1, result] = this.addBytes(bytes, unNextByte);
      bytes = _bytes1;
      if (!result) {
        return [bytes, false];
      }
    }
    return [bytes, true];
  };

  Artifact.prototype.computeChecksum = function(_bytes, unNumBytes) {
    let bytes = _bytes;
    let unChecksum = 0;
    for (
      let unAddCheck = Artifact.knHeaderSize;
      unAddCheck < unNumBytes + Artifact.knHeaderSize;
      unAddCheck++
    ) {
      const byte = bytes[unAddCheck];
      unChecksum += byte;
    }
    return [_bytes, unChecksum];
  };

  Artifact.prototype.encodeBytesToString = function(bytes) {
    const byteCount = bytes.length;
    if (byteCount === 0) {
      return false;
    }
    const packed = bytes.map(b => String.fromCharCode(b)).join("");
    const encoded = btoa(packed);
    const deckString = Artifact.encodedPrefix + encoded;
    let fixedString = deckString.replace(/\//g, "-");
    fixedString = deckString.replace(/=/g, "_");
    return fixedString;
  };
  Artifact.prototype.addCardToBuffer = function(unCount, unValue, _bytes) {
    let bytes = _bytes;
    if (unCount === 0) {
      return false;
    }
    const countBytesStart = bytes.length;
    const knFirstByteMaxCount = 0x03;
    const bExtendedCount = unCount - 1 >= knFirstByteMaxCount;
    const unFirstByteCount = bExtendedCount ? knFirstByteMaxCount : unCount - 1;
    let unFirstByte = unFirstByteCount << 6;
    unFirstByte |= this.extractNBitsWithCarry(unValue, 5);
    let [returnBytes, addBytesResult] = this.addBytes(bytes, unFirstByte);
    bytes = returnBytes;
    if (!addBytesResult) {
      return [bytes, false];
    }
    let [
      returnBytes1,
      addRemainingNumberToBufferResult
    ] = this.addRemainingNumberToBuffer(unValue, 5, bytes);
    bytes = returnBytes1;

    if (!addRemainingNumberToBufferResult) {
      return [bytes, false];
    }

    if (bExtendedCount) {
      let [
        returnBytes2,
        addRemainingNumberToBufferResult1
      ] = this.addRemainingNumberToBuffer(unCount, 0, bytes);
      bytes = returnBytes2;
      if (!addRemainingNumberToBufferResult1) {
        return [bytes, false];
      }
    }
    const countBytesEnd = bytes.length;
    if (countBytesEnd - countBytesStart > 11) {
      return [bytes, false];
    }
    return [bytes, true];
  };
  return Artifact;
})();
