from fontype_engine.protocol import decode, encode


def test_encode_decode_roundtrip():
    message = {"jobId": "j1", "type": "progress", "data": {"message": "مرحبا"}}
    assert decode(encode(message)) == message


def test_decode_rejects_non_object():
    try:
        decode("[1,2,3]")
    except ValueError:
        return
    raise AssertionError("expected ValueError")
