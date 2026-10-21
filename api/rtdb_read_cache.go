package api

import (
	"context"
	"fmt"
	"sync"
	"time"

	firebaseDB "firebase.google.com/go/v4/db"
	"golang.org/x/sync/singleflight"
)

type publicReadEntry struct {
	value   interface{}
	expires time.Time
}

var publicReads = struct {
	sync.Mutex
	client     *firebaseDB.Client
	generation uint64
	entries    map[string]publicReadEntry
	group      singleflight.Group
}{entries: map[string]publicReadEntry{}}

func invalidatePublicReads() {
	publicReads.Lock()
	defer publicReads.Unlock()
	publicReads.generation++
	clear(publicReads.entries)
}

func publicCollection(path string) bool {
	switch path {
	case "items", "auctions", "themes", "sessions", "categories", "bids", "schedules":
		return true
	default:
		return false
	}
}

func rtdbRead(ctx context.Context, path string) (interface{}, error) {
	ref, err := rtdbRef(path)
	if err != nil {
		return nil, err
	}
	if !publicCollection(path) {
		var value interface{}
		err := ref.Get(ctx, &value)
		return value, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	publicReads.Lock()
	client := firebaseDatabaseClient
	if publicReads.client != client {
		publicReads.client = client
		publicReads.generation++
		clear(publicReads.entries)
	}
	generation := publicReads.generation
	entry, ok := publicReads.entries[path]
	publicReads.Unlock()
	if ok && time.Now().Before(entry.expires) {
		return entry.value, nil
	}
	key := fmt.Sprintf("%p:%d:%s", client, generation, path)
	result := publicReads.group.DoChan(key, func() (interface{}, error) {
		publicReads.Lock()
		entry, ok := publicReads.entries[path]
		current := publicReads.client == client && publicReads.generation == generation
		publicReads.Unlock()
		if current && ok && time.Now().Before(entry.expires) {
			return entry.value, nil
		}
		// A disconnected first reader must not cancel the shared fetch for other callers.
		readCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 8*time.Second)
		defer cancel()
		var value interface{}
		if err := ref.Get(readCtx, &value); err != nil {
			return nil, err
		}
		publicReads.Lock()
		if publicReads.client == client && publicReads.generation == generation {
			publicReads.entries[path] = publicReadEntry{value: value, expires: time.Now().Add(250 * time.Millisecond)}
		}
		publicReads.Unlock()
		return value, nil
	})
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case completed := <-result:
		return completed.Val, completed.Err
	}
}
