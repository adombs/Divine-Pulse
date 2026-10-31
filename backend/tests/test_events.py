import asyncio

from app.events import EventBus


def test_close_ends_streams_and_listeners_see_events():
    seen = []

    async def scenario():
        bus = EventBus()
        bus.bind(asyncio.get_running_loop())
        bus.add_listener(lambda event, data: seen.append(event))
        q = bus.subscribe()
        for i in range(150):  # more than the queue holds
            bus.publish("scan", i)
        bus.close()
        await asyncio.sleep(0)
        messages = []
        while not q.empty():
            messages.append(q.get_nowait())
        return messages

    messages = asyncio.run(scenario())
    assert messages[-1] is None  # end marker always arrives, even on a full queue
    assert len(seen) == 150


def test_publish_and_close_after_loop_shutdown():
    loop = asyncio.new_event_loop()
    bus = EventBus()
    bus.bind(loop)
    loop.close()
    bus.publish("scan", {})
    bus.close()
